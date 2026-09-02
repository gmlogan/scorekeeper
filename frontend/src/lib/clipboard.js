// Copy text to the clipboard, working outside secure contexts too.
// navigator.clipboard is undefined on plain-HTTP origins (e.g. http://host.local:5000),
// so fall back to a hidden <textarea> + execCommand.
export async function copyText(text) {
  const value = String(text ?? '');

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
