// The Clavis icon packer: PNG files → .ico.
//
// Small sizes (≤64) become 32bpp BGRA DIB entries (maximum compatibility
// with the Windows 10 shell); 256px stays a PNG-compressed entry.
package main

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: icopack <output.ico> <size:png> [<size:png> ...]")
		os.Exit(2)
	}
	out, err := os.Create(os.Args[1])
	if err != nil {
		fatal(err)
	}
	defer out.Close()
	w := bufio.NewWriter(out)

	type entry struct {
		width  int
		height int
		data   []byte
		png    bool
	}
	var entries []entry
	for _, spec := range os.Args[2:] {
		parts := strings.SplitN(spec, ":", 2)
		if len(parts) != 2 {
			fatal(fmt.Errorf("bad spec %q", spec))
		}
		var size int
		fmt.Sscanf(parts[0], "%d", &size)
		f, err := os.Open(parts[1])
		if err != nil {
			fatal(err)
		}
		img, err := png.Decode(f)
		f.Close()
		if err != nil {
			fatal(fmt.Errorf("%s: %w", parts[1], err))
		}
		b := img.Bounds()
		if b.Dx() != size || b.Dy() != size {
			fatal(fmt.Errorf("%s is %dx%d, expected %d", parts[1], b.Dx(), b.Dy(), size))
		}
		if size >= 128 {
			raw, err := os.ReadFile(parts[1])
			if err != nil {
				fatal(err)
			}
			entries = append(entries, entry{width: size, height: size, data: raw, png: true})
		} else {
			entries = append(entries, entry{width: size, height: size, data: dibEntry(img)})
		}
	}

	// ICONDIR
	binary.Write(w, binary.LittleEndian, uint16(0))
	binary.Write(w, binary.LittleEndian, uint16(1)) // icons
	binary.Write(w, binary.LittleEndian, uint16(len(entries)))
	offset := 6 + 16*len(entries)
	for _, e := range entries {
		dim := e.width
		if dim >= 256 {
			dim = 0
		}
		w.WriteByte(byte(dim))
		w.WriteByte(byte(dim))
		w.WriteByte(0)                                   // colors
		w.WriteByte(0)                                   // reserved
		binary.Write(w, binary.LittleEndian, uint16(1))  // planes
		binary.Write(w, binary.LittleEndian, uint16(32)) // bpp
		binary.Write(w, binary.LittleEndian, uint32(len(e.data)))
		binary.Write(w, binary.LittleEndian, uint32(offset))
		offset += len(e.data)
	}
	for _, e := range entries {
		if _, err := w.Write(e.data); err != nil {
			fatal(err)
		}
	}
	if err := w.Flush(); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %s (%d entries)\n", filepath.Base(os.Args[1]), len(entries))
}

// dibEntry converts an image to a 32bpp bottom-up BGRA DIB with a zeroed
// AND mask (the alpha channel carries transparency).
func dibEntry(img image.Image) []byte {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	xorRow := w * 4
	xorLen := xorRow * h
	maskRow := ((w + 31) / 32) * 4
	maskLen := maskRow * h
	total := 40 + xorLen + maskLen
	out := make([]byte, total)
	// BITMAPINFOHEADER
	le := binary.LittleEndian
	le.PutUint32(out[0:4], 40)
	le.PutUint32(out[4:8], uint32(w))
	le.PutUint32(out[8:12], uint32(h*2)) // double height (XOR + AND)
	le.PutUint16(out[12:14], 1)
	le.PutUint16(out[14:16], 32)
	// bottom-up BGRA
	at := func(x, y int) (uint8, uint8, uint8, uint8) {
		r, g, bl, a := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
		return uint8(r >> 8), uint8(g >> 8), uint8(bl >> 8), uint8(a >> 8)
	}
	for y := 0; y < h; y++ {
		rowStart := 40 + (h-1-y)*xorRow
		for x := 0; x < w; x++ {
			r, g, bl, a := at(x, y)
			i := rowStart + x*4
			out[i], out[i+1], out[i+2], out[i+3] = bl, g, r, a
		}
	}
	return out
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "icopack:", err)
	os.Exit(1)
}
