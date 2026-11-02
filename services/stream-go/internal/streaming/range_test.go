package streaming

import "testing"

func TestParseRange(t *testing.T) {
	for _, tc := range []struct {
		value            string
		size, start, end int64
	}{
		{"", 1000, 0, 999}, {"bytes=100-199", 1000, 100, 199}, {"bytes=0-0", 1000, 0, 0},
		{"bytes=900-", 1000, 900, 999}, {"bytes=-100", 1000, 900, 999}, {"bytes=-2000", 1000, 0, 999}, {"Bytes=1-9", 1000, 1, 9},
		{"bytes=900-2000", 1000, 900, 999}, {"bytes=0-9223372036854775807", 1000, 0, 999},
	} {
		r, err := ParseRange(tc.value, tc.size)
		if err != nil || r.Start != tc.start || r.End != tc.end || r.Length() != tc.end-tc.start+1 {
			t.Errorf("%q: %+v %v", tc.value, r, err)
		}
	}
	for _, value := range []string{"bytes=", "bytes=-0", "bytes=-", "bytes=1000-", "bytes=200-100", "bytes=-1-9", "bytes=+1-9", "bytes=1.5-9", "items=0-1", "bytes=0-1,3-4", "bytes=1-2-3", "bytes= 1-2", "bytes=1-999999999999999999999"} {
		if _, err := ParseRange(value, 1000); err == nil {
			t.Errorf("accepted %q", value)
		}
	}
	if _, err := ParseRange("", 0); err == nil {
		t.Fatal("unknown/empty size accepted")
	}
}

func TestChunkAndLoopbackValidation(t *testing.T) {
	for _, n := range []int{4096, 8192, 65536, 1048576} {
		if err := ValidateChunk(n); err != nil {
			t.Fatal(err)
		}
	}
	for _, n := range []int{0, 1024, 4097, 12288, 2097152} {
		if ValidateChunk(n) == nil {
			t.Fatalf("accepted chunk %d", n)
		}
	}
	for _, addr := range []string{"127.0.0.1:8080", "[::1]:8080"} {
		if ValidateAddress(addr) != nil {
			t.Fatal(addr)
		}
	}
	for _, addr := range []string{"0.0.0.0:8080", ":8080", "192.168.1.1:8080", "localhost:8080", "[::]:8080", "127.0.0.1:0", "127.0.0.1:65536"} {
		if ValidateAddress(addr) == nil {
			t.Fatal(addr)
		}
	}
}
