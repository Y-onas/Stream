package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/auth"
	"github.com/gotd/td/tg"
	"streamweb/internal/config"
	"streamweb/internal/discovery"
	"streamweb/internal/media"
	"streamweb/internal/streaming"
	login "streamweb/internal/telegram"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func run() error {
	mode := flag.String("mode", "discover", "discover, list, inspect, find, or serve")
	name := flag.String("source", "Stream Test", "exact source display name (case-insensitive)")
	pageSize := flag.Int("page-size", 50, "messages per API request (1..100)")
	max := flag.Int("max", 100, "maximum messages inspected")
	offset := flag.Int("offset-id", 0, "inspect messages older than this ID; 0 starts at newest")
	id := flag.Int("message-id", 0, "message ID for inspect or serve mode")
	address := flag.String("listen", "127.0.0.1:8080", "development-only numeric loopback address")
	chunk := flag.Int("chunk-size", 262144, "Telegram part bytes: power of two, 4096..1048576")
	concurrency := flag.Int("concurrency", 2, "maximum active stream requests (1..8)")
	partTimeout := flag.Duration("part-timeout", 20*time.Second, "deadline per Telegram part, including retries")
	requestTimeout := flag.Duration("request-timeout", 30*time.Minute, "maximum duration of an HTTP stream request")
	verify := flag.Bool("verify-stream", false, "with serve: run bounded live HTTP/Telegram byte comparisons, then exit")
	sessionPath := flag.String("session", ".sessions/telegram.session.json", "session file in a dedicated private directory")
	envPath := flag.String("env", ".env", "local dotenv file")
	timeout := flag.Duration("timeout", 5*time.Minute, "discovery or server initialization timeout including login")
	check := flag.Bool("check-config", false, "validate configuration without contacting Telegram")
	flag.Parse()
	if flag.NArg() != 0 {
		return errors.New("unexpected positional arguments; use -help for flags")
	}
	if *mode != "discover" && *mode != "list" && *mode != "inspect" && *mode != "find" && *mode != "serve" {
		return errors.New("mode must be discover, list, inspect, find, or serve")
	}
	if *pageSize < 1 || *pageSize > 100 || *max < 1 || *offset < 0 || int64(*offset) > 2147483647 || *timeout <= 0 || strings.TrimSpace(*name) == "" {
		return errors.New("use page-size 1..100, positive max and timeout, nonnegative 32-bit offset-id, and a nonempty source name")
	}
	if (*mode == "inspect" || *mode == "serve") && (*id <= 0 || int64(*id) >= 2147483647) {
		return errors.New("inspect and serve require -message-id between 1 and 2147483646")
	}
	if *verify && *mode != "serve" {
		return errors.New("-verify-stream requires -mode serve")
	}
	if *mode == "serve" {
		if err := streaming.ValidateAddress(*address); err != nil {
			return err
		}
		if err := streaming.ValidateChunk(*chunk); err != nil {
			return err
		}
		if *concurrency < 1 || *concurrency > 8 || *partTimeout <= 0 || *requestTimeout <= 0 {
			return errors.New("use concurrency 1..8 and positive streaming timeouts")
		}
	}
	cfg, err := config.Load(*envPath)
	if err != nil {
		return err
	}
	if *check {
		fmt.Println("Configuration valid. Telegram credentials are present; database configuration is not required. No network request made.")
		return nil
	}
	storage, err := login.NewStorage(*sessionPath)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if *mode != "serve" {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, *timeout)
		defer cancel()
	}
	client := telegram.NewClient(cfg.APIID, cfg.APIHash, telegram.Options{SessionStorage: storage, NoUpdates: true, OnTransfer: login.SerialTransfers()})
	fmt.Fprintln(os.Stderr, "Reusing the saved session if authorized. First login prompts for phone, code, and optional two-step password in this terminal.")
	var operationErr error
	err = client.Run(ctx, func(ctx context.Context) (result error) {
		defer func() { operationErr = result }()
		setupCtx, cancelSetup := context.WithTimeout(ctx, *timeout)
		defer cancelSetup()
		if err := client.Auth().IfNecessary(setupCtx, auth.NewFlow(login.Terminal{}, auth.SendCodeOptions{})); err != nil {
			return fmt.Errorf("authentication: %s", login.Explain(err))
		}
		status, err := client.Auth().Status(setupCtx)
		if err != nil {
			return fmt.Errorf("verify authentication: %s", login.Explain(err))
		}
		if !status.Authorized {
			return errors.New("Telegram authentication was not authorized")
		}
		fmt.Println("Telegram authentication: successful")
		matches, err := discovery.Find(setupCtx, client.API(), *name)
		if errors.Is(err, discovery.ErrSourceMissing) {
			return err
		}
		if err != nil {
			return fmt.Errorf("find source: %s", login.Explain(err))
		}
		source, err := selectSource(matches)
		if err != nil {
			return err
		}
		fmt.Printf("Source: %q\nSource type: %s\nSource ID: %d\n", source.Info.Name, source.Info.Kind, source.Info.ID)
		if *mode == "serve" {
			cancelSetup()
			return serve(ctx, client, source, serveOptions{address: *address, messageID: *id, chunk: *chunk, concurrency: *concurrency, setupTimeout: *timeout, partTimeout: *partTimeout, requestTimeout: *requestTimeout, verify: *verify})
		}
		fetch := discovery.History(client.API(), source)
		// A real history request confirms read access, including for find mode.
		if *mode == "find" {
			if _, err := fetch(ctx, 0, 1); err != nil {
				return fmt.Errorf("confirm history access: %s", login.Explain(err))
			}
			fmt.Println("History access: confirmed")
			return nil
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if *mode == "inspect" {
			message, err := discovery.Inspect(ctx, fetch, *id)
			if err != nil {
				return fmt.Errorf("cannot inspect message: it may be deleted or inaccessible; %s", login.Explain(err))
			}
			return encoder.Encode(media.Extract(message, source.Info))
		}
		videos, other, textOnly := 0, 0, 0
		fmt.Println("Discovered media / messages (title candidates are unverified):")
		progress, err := discovery.Walk(ctx, fetch, *pageSize, *max, *offset, func(message tg.MessageClass) error {
			m := media.Extract(message, source.Info)
			switch m.MediaType {
			case "video":
				videos++
			case "text", "service", "unavailable":
				textOnly++
			default:
				other++
			}
			if *mode == "list" || m.MediaType == "video" || (m.MediaType != "text" && m.MediaType != "service" && m.MediaType != "unavailable") {
				return encoder.Encode(m)
			}
			return nil
		})
		fmt.Printf("Messages inspected: %d\nVideos: %d; other files/media: %d; text/service/unavailable: %d\n", progress.Inspected, videos, other, textOnly)
		if progress.NextOffset > 0 && !progress.Exhausted {
			fmt.Printf("Continue older history with: -offset-id %d\n", progress.NextOffset)
		}
		if err != nil {
			return fmt.Errorf("history scan incomplete: %s", login.Explain(err))
		}
		if progress.Exhausted {
			fmt.Println("End of accessible history.")
		}
		return nil
	})
	if operationErr != nil {
		return operationErr
	}
	if err != nil {
		return errors.New(login.Explain(err))
	}
	return nil
}

func selectSource(matches []discovery.Source) (discovery.Source, error) {
	if len(matches) == 1 {
		return matches[0], nil
	}
	if len(matches) == 0 {
		return discovery.Source{}, discovery.ErrSourceMissing
	}
	fmt.Fprintln(os.Stderr, "Multiple matching sources. Select explicitly:")
	for i, source := range matches {
		fmt.Fprintf(os.Stderr, "%d. %q (%s, ID %d)\n", i+1, source.Info.Name, source.Info.Kind, source.Info.ID)
	}
	fmt.Fprint(os.Stderr, "Source number: ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return discovery.Source{}, errors.New("source selection requires input; rerun in an interactive terminal")
	}
	n, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || n < 1 || n > len(matches) {
		return discovery.Source{}, errors.New("invalid source selection; rerun and choose a listed number")
	}
	return matches[n-1], nil
}
