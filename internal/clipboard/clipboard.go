/**
 * CLAVIS — clipboard with privacy formats (SPEC §5.2, §6).
 *
 * WriteText writes CF_UNICODETEXT. When the payload contains a secret it
 * ALSO sets the Windows clipboard formats that keep tokens out of Win+V
 * clipboard history and cloud sync:
 *   - "ExcludeClipboardContentFromMonitorProcessing" (presence)
 *   - "CanIncludeInClipboardHistory"  = 0
 *   - "CanUploadToCloudClipboard"     = 0
 * SECURITY: the text is never logged.
 */
package clipboard

// WriteText puts text on the clipboard. excludeFromHistory marks the
// content so Windows does not retain or sync it.
func WriteText(text string, excludeFromHistory bool) bool {
	return writeText(text, excludeFromHistory)
}
