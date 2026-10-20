// The Clavis resource compiler: icon + manifest + version info → .syso.
// Mirrors the Wails v3 build tooling (internal/commands/syso.go) so the
// produced object file is identical in structure.
package main

import (
	"fmt"
	"os"

	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"
)

func main() {
	if len(os.Args) != 6 {
		fmt.Fprintln(os.Stderr, "usage: syso <appicon.ico> <app.manifest> <info.json> <arch> <out.syso>")
		os.Exit(2)
	}
	rs := winres.ResourceSet{}

	icoFile, err := os.Open(os.Args[1])
	if err != nil {
		fatal(err)
	}
	ico, err := winres.LoadICO(icoFile)
	icoFile.Close()
	if err != nil {
		fatal(fmt.Errorf("load icon: %w", err))
	}
	if err := rs.SetIcon(winres.RT_ICON, ico); err != nil {
		fatal(err)
	}

	manifestData, err := os.ReadFile(os.Args[2])
	if err != nil {
		fatal(err)
	}
	xmlData, err := winres.AppManifestFromXML(manifestData)
	if err != nil {
		fatal(fmt.Errorf("manifest: %w", err))
	}
	rs.SetManifest(xmlData)

	infoData, err := os.ReadFile(os.Args[3])
	if err != nil {
		fatal(err)
	}
	var v version.Info
	if err := v.UnmarshalJSON(infoData); err != nil {
		fatal(fmt.Errorf("version info: %w", err))
	}
	rs.SetVersionInfo(v)

	archMap := map[string]winres.Arch{
		"amd64": winres.ArchAMD64,
		"arm64": winres.ArchARM64,
		"386":   winres.ArchI386,
	}
	arch, ok := archMap[os.Args[4]]
	if !ok {
		fatal(fmt.Errorf("unsupported arch %q", os.Args[4]))
	}

	out, err := os.Create(os.Args[5])
	if err != nil {
		fatal(err)
	}
	defer out.Close()
	if err := rs.WriteObject(out, arch); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %s\n", os.Args[5])
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "syso:", err)
	os.Exit(1)
}
