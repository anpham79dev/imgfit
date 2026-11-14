// Go: gọi CLI imgfit, decode JSON report. Chỉ dùng thư viện chuẩn.
//
//	go run ./examples/go <thư-mục-ảnh> <thư-mục-output>
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
)

type Issue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type FileResult struct {
	File        string  `json:"file"`
	Destination *string `json:"destination"`
	Status      string  `json:"status"`
	OutputBytes *int64  `json:"outputBytes"`
	Errors      []Issue `json:"errors"`
	Warnings    []Issue `json:"warnings"`
}

type Report struct {
	SchemaVersion int          `json:"schemaVersion"`
	Status        string       `json:"status"` // ok | failed | aborted | cancelled | error
	Files         []FileResult `json:"files"`
	Errors        []Issue      `json:"errors"`
	Summary       struct {
		Created int `json:"created"`
		Failed  int `json:"failed"`
	} `json:"summary"`
}

func imgfitBin() string {
	if b := os.Getenv("IMGFIT_BIN"); b != "" {
		return b
	}
	return "imgfit"
}

func main() {
	src, dst := "raw", "out"
	if len(os.Args) > 1 {
		src = os.Args[1]
	}
	if len(os.Args) > 2 {
		dst = os.Args[2]
	}

	cmd := exec.Command(imgfitBin(), "resize", src, "-r",
		"--size", "256x256", "--mode", "cover", "--format", "webp",
		"--output", dst, "--name", "{dir}/{name}.{ext}", "--json")
	out, err := cmd.Output() // exit != 0 vẫn có stdout; err khi đó là *exec.ExitError
	exitCode := 0
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		exitCode = exitErr.ExitCode()
	} else if err != nil {
		fmt.Fprintln(os.Stderr, "Không chạy được imgfit:", err)
		os.Exit(3)
	}

	var report Report
	if err := json.Unmarshal(out, &report); err != nil {
		fmt.Fprintln(os.Stderr, "JSON không hợp lệ:", err)
		os.Exit(3)
	}
	if report.Status == "error" {
		for _, e := range report.Errors {
			fmt.Fprintf(os.Stderr, "[%s] %s\n", e.Code, e.Message)
		}
		os.Exit(exitCode)
	}
	for _, f := range report.Files {
		dest := "?"
		if f.Destination != nil {
			dest = *f.Destination
		}
		line := fmt.Sprintf("%-9s %s -> %s", f.Status, f.File, dest)
		if len(f.Errors) > 0 {
			line += fmt.Sprintf("  [%s] %s", f.Errors[0].Code, f.Errors[0].Message)
		}
		fmt.Println(line)
	}
	fmt.Printf("status=%s created=%d failed=%d\n", report.Status, report.Summary.Created, report.Summary.Failed)
	os.Exit(exitCode)
}
