package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/updates"
	"github.com/gotd/td/tg"
	"github.com/gotd/td/tgerr"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"streamweb/internal/catalogue"
	"streamweb/internal/config"
	"streamweb/internal/discovery"
	"streamweb/internal/streaming"
	login "streamweb/internal/telegram"
	"strings"
	"sync"
	"syscall"
	"time"
)

type runtime struct {
	client *telegram.Client
	source discovery.Source
	ctx    context.Context
}
type service struct {
	mu      sync.RWMutex
	current *runtime
	store   *catalogue.Store
	token   string
	slots   chan struct{}
	poll    time.Duration
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (s *service) get() *runtime  { s.mu.RLock(); defer s.mu.RUnlock(); return s.current }
func (s *service) set(r *runtime) { s.mu.Lock(); s.current = r; s.mu.Unlock() }
func (s *service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" && r.Method == "GET" {
		respond(w, 200, map[string]bool{"alive": true})
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
		respond(w, 401, map[string]string{"message": "Unauthorized"})
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		respond(w, 405, map[string]string{"message": "Method not allowed"})
		return
	}
	st := s.store.Snapshot()
	current := s.get()
	if r.URL.Path == "/readyz" {
		status := 200
		if current == nil || !st.InitialComplete || st.LastSuccess.IsZero() || time.Since(st.LastSuccess) > max(3*s.poll, 2*time.Minute) {
			status = 503
		}
		respond(w, status, map[string]any{"telegramConnected": current != nil, "sync": map[string]any{"initialComplete": st.InitialComplete, "lastSuccess": st.LastSuccess, "lastError": st.LastError, "revision": st.Revision}})
		return
	}
	if r.URL.Path == "/internal/catalogue" {
		items := make([]catalogue.Video, 0, len(st.Videos))
		for _, v := range st.Videos {
			items = append(items, v.Video)
		}
		sort.Slice(items, func(i, j int) bool { return items[i].UploadedAt > items[j].UploadedAt })
		respond(w, 200, map[string]any{"items": items, "sync": map[string]any{"initialComplete": st.InitialComplete, "lastSuccess": st.LastSuccess, "lastError": st.LastError, "revision": st.Revision}})
		return
	}
	const prefix = "/internal/videos/"
	if !strings.HasPrefix(r.URL.Path, prefix) || !strings.HasSuffix(r.URL.Path, "/stream") || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	key := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, prefix), "/stream")
	record, ok := st.Videos[key]
	if !ok {
		http.NotFound(w, r)
		return
	}
	if current == nil {
		respond(w, 503, map[string]string{"message": "Telegram connection unavailable; retry shortly"})
		return
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		w.Header().Set("Retry-After", "2")
		respond(w, 503, map[string]string{"message": "Stream capacity reached"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Hour)
	defer cancel()
	stop := context.AfterFunc(current.ctx, cancel)
	defer stop()
	setup, done := context.WithTimeout(ctx, 20*time.Second)
	backend, err := streaming.NewTelegramBackend(setup, current.client, current.source, record.MessageID, 1, 20*time.Second)
	done()
	if err != nil {
		respond(w, 502, map[string]string{"message": streaming.SafeError(err)})
		return
	}
	defer backend.Close()
	handler, err := streaming.NewHandler(backend, streaming.HTTPOptions{TrustedInternal: true, MessageID: record.MessageID, ChunkSize: 262144, Concurrency: 1, RequestTimeout: 3 * time.Hour, WriteTimeout: 15 * time.Second})
	if err != nil {
		respond(w, 500, map[string]string{"message": "Stream initialization failed"})
		return
	}
	request := r.Clone(ctx)
	copiedURL := *r.URL
	request.URL = &copiedURL
	request.URL.Path = "/media/stream/" + strconv.Itoa(record.MessageID)
	slog.Info("stream_started", "video", key, "method", r.Method)
	handler.ServeHTTP(w, request)
}
func matches(message tg.MessageClass, source discovery.Source) bool {
	m, ok := message.(*tg.Message)
	if !ok {
		return false
	}
	switch peer := m.PeerID.(type) {
	case *tg.PeerChannel:
		return peer.ChannelID == source.Info.ID && source.Info.Kind != "group"
	case *tg.PeerChat:
		return peer.ChatID == source.Info.ID && source.Info.Kind == "group"
	}
	return false
}
func (s *service) connect(ctx context.Context, cfg config.Config, session, sourceName string) error {
	storage, err := login.NewStorage(session)
	if err != nil {
		return err
	}
	wake := make(chan struct{}, 1)
	notify := func() {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
	dispatcher := tg.NewUpdateDispatcher()
	apply := func(message tg.MessageClass) error {
		current := s.get()
		if current != nil && matches(message, current.source) {
			// Live changes are persisted directly; scheduled sync and gap callbacks reconcile history.
			if err := s.store.Update(func(st *catalogue.State) error { catalogue.Upsert(st, message); return nil }); err != nil {
				return err
			}
		}
		return nil
	}
	dispatcher.OnNewChannelMessage(func(ctx context.Context, e tg.Entities, u *tg.UpdateNewChannelMessage) error { return apply(u.Message) })
	dispatcher.OnEditChannelMessage(func(ctx context.Context, e tg.Entities, u *tg.UpdateEditChannelMessage) error {
		return apply(u.Message)
	})
	dispatcher.OnNewMessage(func(ctx context.Context, e tg.Entities, u *tg.UpdateNewMessage) error { return apply(u.Message) })
	dispatcher.OnEditMessage(func(ctx context.Context, e tg.Entities, u *tg.UpdateEditMessage) error { return apply(u.Message) })
	dispatcher.OnDeleteChannelMessages(func(ctx context.Context, e tg.Entities, u *tg.UpdateDeleteChannelMessages) error {
		current := s.get()
		if current == nil || current.source.Info.Kind == "group" || current.source.Info.ID != u.ChannelID {
			return nil
		}
		return s.store.Update(func(st *catalogue.State) error {
			for _, id := range u.Messages {
				delete(st.Videos, catalogue.Key(st.Source, id))
			}
			return nil
		})
	})
	manager := updates.New(updates.Config{Handler: dispatcher, MaxChannelDifferenceConcurrency: 1, OnTooLong: notify, OnChannelTooLong: func(int64) { notify() }})
	client := telegram.NewClient(cfg.APIID, cfg.APIHash, telegram.Options{SessionStorage: storage, UpdateHandler: manager, OnTransfer: login.SerialTransfers()})
	return client.Run(ctx, func(clientCtx context.Context) error {
		setup, cancel := context.WithTimeout(clientCtx, 2*time.Minute)
		defer cancel()
		status, err := client.Auth().Status(setup)
		if err != nil {
			return err
		}
		if !status.Authorized {
			return errors.New("saved session is not authorized; run interactive discovery login first")
		}
		sources, err := discovery.Find(setup, client.API(), sourceName)
		if err != nil {
			return err
		}
		if len(sources) != 1 {
			return errors.New("source name must uniquely identify one accessible group/channel")
		}
		source := sources[0]
		if err = s.store.Update(func(st *catalogue.State) error {
			if st.Source.ID != 0 && (st.Source.ID != source.Info.ID || st.Source.Kind != source.Info.Kind) {
				return errors.New("catalogue belongs to another source")
			}
			st.Source = source.Info
			return nil
		}); err != nil {
			return err
		}
		work, stop := context.WithCancel(clientCtx)
		defer stop()
		s.set(&runtime{client: client, source: source, ctx: work})
		defer s.set(nil)
		syncer := catalogue.Syncer{Store: s.store, Fetch: discovery.History(client.API(), source), Source: source.Info, PageSize: 50}
		results := make(chan error, 2)
		go func() { results <- manager.Run(work, client.API(), status.User.ID, updates.AuthOptions{}) }()
		go func() {
			for {
				callCtx, end := context.WithTimeout(work, 30*time.Minute)
				err := syncer.Cycle(callCtx)
				end()
				delay := s.poll
				if err != nil {
					slog.Error("sync_failed", "reason", streaming.SafeError(err))
					if rpc, ok := tgerr.As(err); ok && (rpc.Type == "FLOOD_WAIT" || rpc.Type == "FLOOD_PREMIUM_WAIT") {
						delay = max(delay, time.Duration(rpc.Argument+1)*time.Second)
					}
				} else {
					slog.Info("sync_complete", "videos", len(s.store.Snapshot().Videos))
				}
				timer := time.NewTimer(delay)
				select {
				case <-work.Done():
					timer.Stop()
					results <- work.Err()
					return
				case <-wake:
					timer.Stop()
					if err != nil {
						select {
						case <-work.Done():
							results <- work.Err()
							return
						case <-time.After(delay):
						}
					}
				case <-timer.C:
				}
			}
		}()
		err = <-results
		stop()
		<-results
		return err
	})
}
func run() error {
	envPath := flag.String("env", ".env", "dotenv file")
	flag.Parse()
	cfg, err := config.Load(*envPath)
	if err != nil {
		return err
	}
	token := os.Getenv("STREAM_SERVICE_TOKEN")
	if len(token) < 32 {
		return errors.New("STREAM_SERVICE_TOKEN must be at least 32 characters")
	}
	poll, err := time.ParseDuration(env("SYNC_INTERVAL", "30s"))
	if err != nil || poll < 5*time.Second {
		return errors.New("SYNC_INTERVAL must be at least 5s")
	}
	store, err := catalogue.Open(env("CATALOGUE_PATH", ".local/runtime/catalogue.json"))
	if err != nil {
		return err
	}
	concurrency, err := strconv.Atoi(env("STREAM_CONCURRENCY", "4"))
	if err != nil || concurrency < 1 || concurrency > 8 {
		return errors.New("STREAM_CONCURRENCY must be 1..8")
	}
	s := &service{store: store, token: token, slots: make(chan struct{}, concurrency), poll: poll}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	address := env("STREAM_LISTEN", "127.0.0.1:8080")
	if _, _, err = net.SplitHostPort(address); err != nil {
		return errors.New("invalid STREAM_LISTEN")
	}
	server := &http.Server{Addr: address, Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8192, BaseContext: func(net.Listener) context.Context { return ctx }}
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		delay := time.Second
		for ctx.Err() == nil {
			started := time.Now()
			err := s.connect(ctx, cfg, env("TELEGRAM_SESSION_PATH", ".sessions/telegram.session.json"), env("TELEGRAM_SOURCE", "Stream Test"))
			if ctx.Err() != nil {
				return
			}
			slog.Error("telegram_reconnecting", "reason", streaming.SafeError(err), "retrySeconds", delay.Seconds())
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			if time.Since(started) > time.Minute {
				delay = time.Second
			} else {
				delay = min(delay*2, time.Minute)
			}
		}
	}()
	slog.Info("stream_service_started")
	select {
	case <-ctx.Done():
	case err = <-result:
		if !errors.Is(err, http.ErrServerClosed) {
			stop()
			return err
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = server.Shutdown(shutdown); err != nil {
		_ = server.Close()
	}
	select {
	case <-workerDone:
	case <-shutdown.Done():
	}
	return nil
}
func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		client := http.Client{Timeout: 3 * time.Second}
		address := env("STREAM_HEALTH_URL", "http://127.0.0.1:8080/healthz")
		u, err := url.Parse(address)
		if err != nil || u.Hostname() != "127.0.0.1" {
			os.Exit(1)
		}
		res, err := client.Get(address)
		if err != nil {
			os.Exit(1)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		slog.Error("stream_service_stopped", "reason", "configuration or runtime failure; verify required configuration and state permissions")
		os.Exit(1)
	}
}
