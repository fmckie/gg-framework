// Package ggpixel — Go SDK for gg-pixel error tracking.
//
//	import gg "github.com/kenkaiiii/gg-pixel-go"
//
//	func main() {
//	    gg.Init(gg.Options{ProjectKey: os.Getenv("GG_PIXEL_KEY")})
//	    defer gg.Close()
//	    defer gg.Recover() // captures panics + re-panics
//	    // your code
//	}
package ggpixel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	cryptorand "crypto/rand"
)

const DefaultIngestURL = "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest"
const userAgent = "gg-pixel-go/4.3.72"

// Options configures Init.
type Options struct {
	ProjectKey string
	IngestURL  string // optional; defaults to DefaultIngestURL
	Runtime    string // optional; defaults to "go-<version>"
	Client     *http.Client
}

type Level string

const (
	LevelError   Level = "error"
	LevelWarning Level = "warning"
	LevelFatal   Level = "fatal"
)

type stackFrame struct {
	File  string `json:"file"`
	Line  int    `json:"line"`
	Col   int    `json:"col"`
	Fn    string `json:"fn"`
	InApp bool   `json:"in_app"`
}

type wireEvent struct {
	EventID      string       `json:"event_id"`
	ProjectKey   string       `json:"project_key"`
	Fingerprint  string       `json:"fingerprint"`
	Type         string       `json:"type"`
	Message      string       `json:"message"`
	Stack        []stackFrame `json:"stack"`
	CodeContext  any          `json:"code_context"`
	Runtime      string       `json:"runtime"`
	ManualReport bool         `json:"manual_report"`
	Level        Level        `json:"level"`
	OccurredAt   string       `json:"occurred_at"`
}

type client struct {
	opts   Options
	http   *http.Client
	mu     sync.Mutex
	closed bool
}

var (
	mu     sync.Mutex
	active *client
)

// Init initializes gg-pixel. Call once at program start.
// Returns an error if already initialized.
func Init(opts Options) error {
	mu.Lock()
	defer mu.Unlock()
	if active != nil {
		return fmt.Errorf("gg-pixel already initialized")
	}
	if opts.ProjectKey == "" {
		return fmt.Errorf("ProjectKey is required")
	}
	if opts.IngestURL == "" {
		opts.IngestURL = DefaultIngestURL
	}
	if opts.Runtime == "" {
		opts.Runtime = "go-" + runtime.Version()
	}
	httpClient := opts.Client
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	active = &client{opts: opts, http: httpClient}
	return nil
}

// Close tears down the SDK.
func Close() {
	mu.Lock()
	defer mu.Unlock()
	if active == nil {
		return
	}
	active.closed = true
	active = nil
}

// Report sends a manual message.
func Report(message string) {
	c := getClient()
	if c == nil {
		return
	}
	stack := captureStack(2)
	ev := wireEvent{
		EventID:      newUUID(),
		ProjectKey:   c.opts.ProjectKey,
		Fingerprint:  fingerprint("ManualReport", stack),
		Type:         "ManualReport",
		Message:      message,
		Stack:        stack,
		CodeContext:  nil,
		Runtime:      c.opts.Runtime,
		ManualReport: true,
		Level:        LevelError,
		OccurredAt:   time.Now().UTC().Format(time.RFC3339),
	}
	go c.send(ev) // fire-and-forget background send
}

// CaptureError reports an error.
func CaptureError(err error) {
	if err == nil {
		return
	}
	c := getClient()
	if c == nil {
		return
	}
	stack := captureStack(2)
	typeName := fmt.Sprintf("%T", err)
	if strings.HasPrefix(typeName, "*") {
		typeName = typeName[1:]
	}
	ev := wireEvent{
		EventID:      newUUID(),
		ProjectKey:   c.opts.ProjectKey,
		Fingerprint:  fingerprint(typeName, stack),
		Type:         typeName,
		Message:      err.Error(),
		Stack:        stack,
		CodeContext:  nil,
		Runtime:      c.opts.Runtime,
		ManualReport: true,
		Level:        LevelError,
		OccurredAt:   time.Now().UTC().Format(time.RFC3339),
	}
	go c.send(ev)
}

// Recover is a deferred function that captures panics, sends synchronously,
// and re-panics so default behavior (process abort + stack print) still runs.
//
// Idiomatic use:
//
//	defer gg.Recover()
func Recover() {
	r := recover()
	if r == nil {
		return
	}
	c := getClient()
	if c != nil {
		stack := parseGoStackString(string(debug.Stack()))
		message := fmt.Sprintf("%v", r)
		ev := wireEvent{
			EventID:      newUUID(),
			ProjectKey:   c.opts.ProjectKey,
			Fingerprint:  fingerprint("Panic", stack),
			Type:         "Panic",
			Message:      "panic: " + message,
			Stack:        stack,
			CodeContext:  nil,
			Runtime:      c.opts.Runtime,
			ManualReport: false,
			Level:        LevelFatal,
			OccurredAt:   time.Now().UTC().Format(time.RFC3339),
		}
		c.sendSync(ev)
	}
	panic(r) // re-panic so default behavior runs
}

// ── internals ─────────────────────────────────────────────────────

func getClient() *client {
	mu.Lock()
	defer mu.Unlock()
	return active
}

func (c *client) send(ev wireEvent) {
	if c.closed {
		return
	}
	body, err := json.Marshal(ev)
	if err != nil {
		return
	}
	req, err := http.NewRequest("POST", c.opts.IngestURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-pixel-key", c.opts.ProjectKey)
	req.Header.Set("user-agent", userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[gg-pixel] send failed: %v\n", err)
		return
	}
	defer resp.Body.Close()
}

func (c *client) sendSync(ev wireEvent) {
	c.send(ev)
}

func captureStack(skip int) []stackFrame {
	pcs := make([]uintptr, 64)
	n := runtime.Callers(skip+1, pcs)
	frames := runtime.CallersFrames(pcs[:n])
	out := []stackFrame{}
	for {
		f, more := frames.Next()
		out = append(out, stackFrame{
			File:  f.File,
			Line:  f.Line,
			Col:   0,
			Fn:    f.Function,
			InApp: isInApp(f.File, f.Function),
		})
		if !more {
			break
		}
	}
	return out
}

func parseGoStackString(s string) []stackFrame {
	// debug.Stack() format:
	//   goroutine 1 [running]:
	//   main.foo()
	//       /path/to/file.go:42 +0x1f
	//   ...
	lines := strings.Split(s, "\n")
	var frames []stackFrame
	for i := 0; i < len(lines)-1; i++ {
		fnLine := strings.TrimSpace(lines[i])
		if fnLine == "" || strings.HasPrefix(fnLine, "goroutine ") {
			continue
		}
		// Function lines end with `(...)` — file lines start with `\t`.
		if !strings.Contains(fnLine, "(") {
			continue
		}
		fileLine := strings.TrimSpace(lines[i+1])
		if !strings.Contains(fileLine, ":") {
			continue
		}
		parts := strings.SplitN(fileLine, " ", 2)
		fileAndLine := parts[0]
		colonIdx := strings.LastIndex(fileAndLine, ":")
		if colonIdx == -1 {
			continue
		}
		file := fileAndLine[:colonIdx]
		var line int
		fmt.Sscanf(fileAndLine[colonIdx+1:], "%d", &line)
		fnName := fnLine
		if idx := strings.LastIndex(fnLine, "("); idx > 0 {
			fnName = fnLine[:idx]
		}
		frames = append(frames, stackFrame{
			File:  file,
			Line:  line,
			Col:   0,
			Fn:    fnName,
			InApp: isInApp(file, fnName),
		})
		i++ // skip the file line we just consumed
	}
	return frames
}

func isInApp(file, fn string) bool {
	if file == "" {
		return false
	}
	if strings.Contains(file, "/go/pkg/mod/") {
		return false
	}
	if strings.Contains(file, "/runtime/") || strings.HasPrefix(fn, "runtime.") {
		return false
	}
	return true
}

func fingerprint(errType string, stack []stackFrame) string {
	var normalized string
	if len(stack) > 0 {
		top := stack[0]
		fn := top.Fn
		if fn == "" {
			fn = "<anon>"
		}
		normalized = fmt.Sprintf("%s|%s|%s|%d", errType, normalizeFile(top.File), fn, top.Line)
	} else {
		normalized = errType + "|<no-stack>"
	}
	h := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(h[:8])
}

func normalizeFile(file string) string {
	if idx := strings.Index(file, "/go/pkg/mod/"); idx != -1 {
		return "go/pkg/mod/" + file[idx+len("/go/pkg/mod/"):]
	}
	return file
}

func newUUID() string {
	var b [16]byte
	_, _ = cryptorand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // v4
	b[8] = (b[8] & 0x3f) | 0x80 // variant
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
