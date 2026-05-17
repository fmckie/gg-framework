package main

import (
	"errors"
	"fmt"
	"os"
	"time"

	gg "github.com/kenkaiiii/gg-pixel-go"
)

func main() {
	key := os.Getenv("GG_PIXEL_KEY")
	if key == "" {
		fmt.Fprintln(os.Stderr, "set GG_PIXEL_KEY=pk_live_...")
		os.Exit(1)
	}
	if err := gg.Init(gg.Options{ProjectKey: key}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer gg.Close()
	defer gg.Recover()

	gg.Report("go-smoke: manual report from main()")
	gg.CaptureError(errors.New("go-smoke: captured error via CaptureError"))

	time.Sleep(500 * time.Millisecond)

	// Now panic — Recover() captures and re-panics.
	var s []string
	_ = s[42] // index out of range
}
