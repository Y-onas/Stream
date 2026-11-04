package playback

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testVideo = "01234567-1234-4234-8234-012345678901"
const testSession = "01234567-1234-4234-8234-012345678902"
const testContext = "01234567-1234-4234-8234-012345678903"

func testVerifier(t *testing.T, handler http.HandlerFunc) (*Verifier, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	v, err := New(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}), "test-node", "test-go", server.URL, "abcdefghijklmnopqrstuvwxyz0123456789", 10*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	return v, key
}
func signed(t *testing.T, key *rsa.PrivateKey, change func(*Claims)) string {
	t.Helper()
	at := time.Now().Add(-time.Second)
	c := Claims{VideoID: testVideo, SessionID: testSession, ContextID: testContext, Mode: "VIP", Purpose: "playback", RegisteredClaims: jwt.RegisteredClaims{Issuer: "test-node", Audience: jwt.ClaimStrings{"test-go"}, Subject: "test-user", ID: testSession, IssuedAt: jwt.NewNumericDate(at), ExpiresAt: jwt.NewNumericDate(at.Add(300 * time.Second))}}
	if change != nil {
		change(&c)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	value, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func TestStrictGrantValidation(t *testing.T) {
	v, key := testVerifier(t, func(http.ResponseWriter, *http.Request) { t.Error("signature rejection must not call Node") })
	good := signed(t, key, nil)
	if _, err := v.Verify(good, testVideo); err != nil {
		t.Fatal(err)
	}
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	cases := map[string]string{"missing": "", "tampered": good[:len(good)-8] + "invalid!", "wrong key": signed(t, other, nil), "wrong issuer": signed(t, key, func(c *Claims) { c.Issuer = "other" }), "wrong audience": signed(t, key, func(c *Claims) { c.Audience = jwt.ClaimStrings{"other"} }), "expired": signed(t, key, func(c *Claims) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Second)) }), "wrong access": signed(t, key, func(c *Claims) { c.Mode = "PUBLIC" }), "missing session": signed(t, key, func(c *Claims) { c.SessionID = "" }), "missing expiry": signed(t, key, func(c *Claims) { c.ExpiresAt = nil })}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := v.Verify(value, testVideo); err == nil {
				t.Fatal("accepted invalid grant")
			}
		})
	}
	if _, err := v.Verify(good, testContext); err == nil {
		t.Fatal("accepted wrong video")
	}
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"iss": "test-node", "aud": "test-go", "exp": time.Now().Add(time.Minute).Unix()})
	value, _ := hs.SignedString([]byte("not an RSA key"))
	if _, err := v.Verify(value, testVideo); err == nil {
		t.Fatal("accepted wrong algorithm")
	}
}
func TestRevocationStopsOpenStreamAndDeniesNewRequests(t *testing.T) {
	var revoked atomic.Bool
	v, key := testVerifier(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer abcdefghijklmnopqrstuvwxyz0123456789" {
			t.Error("missing internal authentication")
		}
		if revoked.Load() {
			w.WriteHeader(403)
			return
		}
		json.NewEncoder(w).Encode(lease{Key: "channel-42-3", VideoID: testVideo, Until: time.Now().Add(time.Minute).UnixMilli()})
	})
	value := signed(t, key, nil)
	ctx, stop, keyID, err := v.Open(context.Background(), httptest.NewRecorder(), value, testVideo)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	if keyID != "channel-42-3" {
		t.Fatal("wrong trusted mapping")
	}
	revoked.Store(true)
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("revoked open stream kept running")
	}
	if _, _, _, err := v.Open(context.Background(), httptest.NewRecorder(), value, testVideo); err == nil {
		t.Fatal("revoked grant started new request")
	}
}
func TestLeaseRenewalThenExpiry(t *testing.T) {
	var deadline atomic.Int64

	v, key := testVerifier(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(lease{Key: "channel-42-3", VideoID: testVideo, Until: deadline.Load()})
	})
	value := signed(t, key, nil)
	deadline.Store(time.Now().Add(120 * time.Millisecond).UnixMilli())
	ctx, stop, _, err := v.Open(context.Background(), httptest.NewRecorder(), value, testVideo)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	deadline.Store(time.Now().Add(350 * time.Millisecond).UnixMilli())
	select {
	case <-ctx.Done():
		t.Fatal("renewed session stopped at old deadline")
	case <-time.After(180 * time.Millisecond):
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("expired lease did not cancel active stream")
	}
}
func TestVerificationOutageRetainsOnlyExistingLease(t *testing.T) {
	var failed atomic.Bool
	v, key := testVerifier(t, func(w http.ResponseWriter, r *http.Request) {
		if failed.Load() {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(lease{Key: "channel-42-3", VideoID: testVideo, Until: time.Now().Add(450 * time.Millisecond).UnixMilli()})
	})
	value := signed(t, key, nil)
	ctx, stop, _, err := v.Open(context.Background(), httptest.NewRecorder(), value, testVideo)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	failed.Store(true)
	select {
	case <-ctx.Done():
		t.Fatal("valid existing lease ended before expiry")
	case <-time.After(100 * time.Millisecond):
	}
	if _, _, _, err := v.Open(context.Background(), httptest.NewRecorder(), value, testVideo); err == nil {
		t.Fatal("outage authorized a new request")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("verification failure did not stop playback")
	}
}

func TestDelayedRenewalCannotReviveExpiredLease(t *testing.T) {
	var clock atomic.Int64
	var deadline atomic.Int64
	v, key := testVerifier(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Active bool `json:"active"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		until := deadline.Load()
		if request.Active {
			// Model a delayed policy reply received after the old lease deadline.
			clock.Store(until + 1)
			until += 2000
		}
		json.NewEncoder(w).Encode(lease{Key: "channel-42-3", VideoID: testVideo, Until: until})
	})
	value := signed(t, key, nil)
	clock.Store(time.Now().UnixMilli())
	deadline.Store(clock.Load() + 500)
	v.Now = func() time.Time { return time.UnixMilli(clock.Load()) }
	ctx, stop, _, err := v.Open(context.Background(), httptest.NewRecorder(), value, testVideo)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("late renewal revived an expired lease")
	}
}

func TestRotationCutoffAndStrictExpiration(t *testing.T) {
	v, current := testVerifier(t, func(http.ResponseWriter, *http.Request) { t.Error("verification should not require network") })
	old, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now()
	v.Now = func() time.Time { return at }
	v.Keys = map[string]VerificationKey{"previous": {Key: &old.PublicKey, AcceptUntil: at.Add(time.Minute)}}
	parsed, _, err := jwt.NewParser().ParseUnverified(signed(t, old, nil), &Claims{})
	if err != nil {
		t.Fatal(err)
	}
	parsed.Header["kid"] = "previous"
	value, err := parsed.SignedString(old)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = v.Verify(value, testVideo); err != nil {
		t.Fatal("previous rotation key rejected", err)
	}
	at = at.Add(61 * time.Second)
	if _, err = v.Verify(value, testVideo); err == nil {
		t.Fatal("retired rotation key accepted")
	}
	at = time.Now()
	future := signed(t, current, func(c *Claims) {
		c.IssuedAt = jwt.NewNumericDate(at.Add(20 * time.Second))
		c.ExpiresAt = jwt.NewNumericDate(at.Add(300 * time.Second))
	})
	if _, err = v.Verify(future, testVideo); err != nil {
		t.Fatal("small clock skew rejected", err)
	}
	expired := signed(t, current, func(c *Claims) {
		c.IssuedAt = jwt.NewNumericDate(at.Add(-time.Minute))
		c.ExpiresAt = jwt.NewNumericDate(at.Add(-time.Second))
	})
	if _, err = v.Verify(expired, testVideo); err == nil {
		t.Fatal("clock tolerance accepted an expired grant")
	}
}
