// Package playback verifies Node-issued grants and enforces renewable stream leases.
package playback

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var mediaKey = regexp.MustCompile(`^[\w-]+$`)

type Claims struct {
	VideoID   string `json:"vid"`
	SessionID string `json:"sid"`
	ContextID string `json:"ctx"`
	Mode      string `json:"mode"`
	Purpose   string `json:"purpose"`
	jwt.RegisteredClaims
}
type Denied struct{ Status int }

func (e Denied) Error() string { return "playback authorization denied" }

type Verifier struct {
	Key                                      *rsa.PublicKey
	Issuer, Audience, CheckURL, ServiceToken string
	Interval                                 time.Duration
	Client                                   *http.Client
	Now                                      func() time.Time
	Keys                                     map[string]VerificationKey
	KeyID                                    string
	ClockTolerance                           time.Duration
}
type lease struct {
	Key     string `json:"key"`
	VideoID string `json:"videoId"`
	Until   int64  `json:"leaseUntil"`
}

func New(publicPEM []byte, issuer, audience, checkURL, serviceToken string, interval time.Duration) (*Verifier, error) {
	key, err := jwt.ParseRSAPublicKeyFromPEM(publicPEM)
	if err != nil || key.N.BitLen() < 2048 {
		return nil, errors.New("invalid playback verification key")
	}
	endpoint, err := url.Parse(checkURL)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || issuer == "" || audience == "" || len(serviceToken) < 32 || interval <= 0 || interval > 15*time.Second {
		return nil, errors.New("invalid playback verifier configuration")
	}
	return &Verifier{Key: key, KeyID: publicKeyID(key), ClockTolerance: 30 * time.Second, Issuer: issuer, Audience: audience, CheckURL: checkURL, ServiceToken: serviceToken, Interval: interval, Client: &http.Client{Timeout: 5 * time.Second}, Now: time.Now}, nil
}
func (v *Verifier) Verify(value, videoID string) (*Claims, error) {
	if v == nil || len(value) == 0 || len(value) > 8192 || !uuid.MatchString(videoID) {
		return nil, Denied{401}
	}
	c := &Claims{}
	token, err := jwt.ParseWithClaims(value, c, v.verificationKey, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(v.Issuer), jwt.WithAudience(v.Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(v.ClockTolerance), jwt.WithTimeFunc(v.Now))
	// Clock tolerance admits small future-issued timestamps, never expired grants.
	if err != nil || !token.Valid || token.Header["typ"] != "JWT" || c.VideoID != videoID || !uuid.MatchString(c.ID) || c.IssuedAt == nil || c.ExpiresAt == nil || !c.ExpiresAt.After(v.Now()) || c.Subject == "" || c.ExpiresAt.Sub(c.IssuedAt.Time) <= 0 || c.ExpiresAt.Sub(c.IssuedAt.Time) > 600*time.Second {
		return nil, Denied{401}
	}
	if c.Purpose == "playback" {
		if !uuid.MatchString(c.SessionID) || !uuid.MatchString(c.ContextID) || (c.Mode != "VIP" && c.Mode != "FREE") {
			return nil, Denied{401}
		}
	} else if c.Purpose != "probe" || c.Mode != "INTERNAL" || c.Subject != "media-worker" {
		return nil, Denied{401}
	}
	return c, nil
}
func (v *Verifier) check(ctx context.Context, value string, active bool, videoID, reservationID string) (lease, error) {
	data, _ := json.Marshal(map[string]any{"grant": value, "active": active, "reservationId": reservationID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.CheckURL, bytes.NewReader(data))
	if err != nil {
		return lease{}, Denied{503}
	}
	req.Header.Set("Authorization", "Bearer "+v.ServiceToken)
	req.Header.Set("Content-Type", "application/json")
	response, err := v.Client.Do(req)
	if err != nil {
		return lease{}, Denied{503}
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		status := response.StatusCode
		if status != 401 && status != 403 && status != 404 {
			status = 503
		}
		return lease{}, Denied{status}
	}
	var result lease
	if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result) != nil || result.VideoID != videoID || !mediaKey.MatchString(result.Key) || result.Until <= v.Now().UnixMilli() || result.Until > v.Now().Add(600*time.Second).UnixMilli() {
		return lease{}, Denied{503}
	}
	return result, nil
}

// Open validates every new HTTP request, then monitors the active connection.
// Expired grants cannot start requests. An existing connection may outlive its
// initial JWT only while Node confirms a renewed lease for that same session.
func (v *Verifier) Open(parent context.Context, w http.ResponseWriter, value, videoID string) (context.Context, func(), string, error) {
	claims, err := v.Verify(value, videoID)
	if err != nil {
		return nil, nil, "", err
	}
	var randomID [16]byte
	if _, err = rand.Read(randomID[:]); err != nil {
		return nil, nil, "", Denied{503}
	}
	randomID[6] = (randomID[6] & 15) | 64
	randomID[8] = (randomID[8] & 63) | 128
	reservationID := fmt.Sprintf("%x-%x-%x-%x-%x", randomID[0:4], randomID[4:6], randomID[6:8], randomID[8:10], randomID[10:16])
	initial, err := v.check(parent, value, false, videoID, reservationID)
	if err != nil {
		return nil, nil, "", err
	}
	if claims.Purpose == "probe" && initial.Until > claims.ExpiresAt.UnixMilli() {
		initial.Until = claims.ExpiresAt.UnixMilli()
	}
	ctx, cancel := context.WithCancel(parent)
	var finished atomic.Bool
	var stopped sync.Once
	stop := func() { stopped.Do(func() { finished.Store(true); cancel(); v.release(reservationID) }) }
	updates := make(chan lease, 1)
	failures := make(chan struct{}, 1)
	if claims.Purpose == "playback" {
		go func() {
			ticker := time.NewTicker(v.Interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					next, err := v.check(ctx, value, true, videoID, reservationID)
					var temporary Denied
					if errors.As(err, &temporary) && temporary.Status == 503 {
						continue
					}
					if err != nil || next.Key != initial.Key {
						select {
						case failures <- struct{}{}:
						default:
						}
						return
					}
					select {
					case updates <- next:
					case <-ctx.Done():
						return
					}
				}
			}
		}()
	}
	go func() {
		deadline := initial.Until
		timer := time.NewTimer(time.Until(time.UnixMilli(initial.Until)))
		defer timer.Stop()
		abort := func() {
			if !finished.Load() {
				_ = http.NewResponseController(w).SetWriteDeadline(time.Now())
			}
			cancel()
		}
		for {
			select {
			case <-ctx.Done():
				if !finished.Load() {
					_ = http.NewResponseController(w).SetWriteDeadline(time.Now())
				}
				return
			case <-failures:
				abort()
				return
			case <-timer.C:
				abort()
				return
			case next := <-updates:
				// A delayed renewal cannot resurrect an already-expired lease,
				// even when both the update and timer channels are ready.
				if v.Now().UnixMilli() >= deadline {
					abort()
					return
				}
				deadline = next.Until
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(time.Until(time.UnixMilli(next.Until)))
			}
		}
	}()
	return ctx, stop, initial.Key, nil
}
