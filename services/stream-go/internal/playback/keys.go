package playback

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"os"
	"strings"
	"time"
)

type VerificationKey struct {
	Key         *rsa.PublicKey
	AcceptUntil time.Time
}

func publicKeyID(key *rsa.PublicKey) string {
	der, _ := x509.MarshalPKIXPublicKey(key)
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])[:16]
}
func (v *Verifier) verificationKey(token *jwt.Token) (any, error) {
	kid, exists := token.Header["kid"]
	if !exists {
		return v.Key, nil
	} // Legacy current-key grants expire within five minutes.
	id, ok := kid.(string)
	if !ok {
		return nil, errors.New("invalid key identifier")
	}
	if id == v.KeyID {
		return v.Key, nil
	}
	if entry, ok := v.Keys[id]; ok && v.Now().Before(entry.AcceptUntil) {
		return entry.Key, nil
	}
	return nil, errors.New("unknown or retired signing key")
}
func (v *Verifier) ConfigureKeys(id, path string, tolerance time.Duration) error {
	if tolerance < 0 || tolerance > 30*time.Second {
		return errors.New("invalid clock tolerance")
	}
	v.ClockTolerance = tolerance
	if id != "" {
		if len(id) > 64 || !mediaKey.MatchString(id) {
			return errors.New("invalid signing key identifier")
		}
		v.KeyID = id
	}
	v.Keys = make(map[string]VerificationKey)
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 32768 {
		return errors.New("cannot read previous public keys")
	}
	var ring struct {
		Keys []struct {
			Kid         string    `json:"kid"`
			PublicKey   string    `json:"publicKey"`
			AcceptUntil time.Time `json:"acceptUntil"`
		}
	}
	if json.Unmarshal(data, &ring) != nil || len(ring.Keys) > 2 {
		return errors.New("invalid previous public keys")
	}
	for _, entry := range ring.Keys {
		key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(entry.PublicKey))
		if err != nil || key.N.BitLen() < 2048 || entry.Kid == "" || len(entry.Kid) > 64 || !mediaKey.MatchString(entry.Kid) || entry.Kid == v.KeyID || entry.AcceptUntil.IsZero() || entry.AcceptUntil.After(v.Now().Add(24*time.Hour)) {
			return errors.New("invalid rotation key")
		}
		if _, exists := v.Keys[entry.Kid]; exists {
			return errors.New("duplicate rotation key")
		}
		v.Keys[entry.Kid] = VerificationKey{Key: key, AcceptUntil: entry.AcceptUntil}
	}
	return nil
}
func (v *Verifier) release(id string) {
	endpoint := strings.TrimSuffix(v.CheckURL, "/check") + "/release"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	data, _ := json.Marshal(map[string]string{"reservationId": id})
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+v.ServiceToken)
	req.Header.Set("Content-Type", "application/json")
	if res, err := v.Client.Do(req); err == nil {
		res.Body.Close()
	}
}

func (v *Verifier) Source(videoID, status string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	data, _ := json.Marshal(map[string]string{"videoId": videoID, "status": status})
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(v.CheckURL, "/check")+"/source", bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+v.ServiceToken)
	req.Header.Set("Content-Type", "application/json")
	if res, err := v.Client.Do(req); err == nil {
		res.Body.Close()
	}
}

// History scans consume the same persistent upstream budget as media requests.
// Each page must finish before its fixed lease; no background queue is added.
func (v *Verifier) Discovery(parent context.Context) (context.Context, func(), error) {
	var idBytes [16]byte
	if _, err := rand.Read(idBytes[:]); err != nil {
		return nil, nil, err
	}
	idBytes[6] = (idBytes[6] & 15) | 64
	idBytes[8] = (idBytes[8] & 63) | 128
	id := fmt.Sprintf("%x-%x-%x-%x-%x", idBytes[0:4], idBytes[4:6], idBytes[6:8], idBytes[8:10], idBytes[10:16])
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	data, _ := json.Marshal(map[string]string{"reservationId": id})
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(v.CheckURL, "/check")+"/work", bytes.NewReader(data))
	if err != nil {
		cancel()
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+v.ServiceToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := v.Client.Do(req)
	if err != nil {
		cancel()
		return nil, nil, Denied{503}
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		cancel()
		return nil, nil, Denied{503}
	}
	return ctx, func() { cancel(); v.release(id) }, nil
}
