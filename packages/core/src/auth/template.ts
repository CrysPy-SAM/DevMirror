/**
 * @devmirror/core - Public Preview Authentication HTML Template
 * Self-contained, responsive, mobile-optimized password entry interface.
 */

import { PUBLIC_AUTH_ENDPOINT } from '@devmirror/shared';

export interface RenderAuthPageOptions {
  projectName?: string;
  errorMessage?: string;
  returnTo?: string;
  isLockedOut?: boolean;
}

export function renderPublicAuthPage(options: RenderAuthPageOptions = {}): string {
  const projectTitle = options.projectName ? escapeHtml(options.projectName) : 'DevMirror Mobile Preview';
  const errorHtml = options.errorMessage
    ? `<div class="error-banner" role="alert">
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
        </svg>
        <span>${escapeHtml(options.errorMessage)}</span>
      </div>`
    : '';

  const returnToInput = options.returnTo
    ? `<input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo)}" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${projectTitle} - Authentication</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
    }
    .auth-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 1rem;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      width: 100%;
      max-width: 24rem;
      padding: 2rem 1.5rem;
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      margin-bottom: 1rem;
    }
    .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #38bdf8;
    }
    h1 {
      font-size: 1.375rem;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 0.5rem;
    }
    p.subtitle {
      color: #94a3b8;
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
      line-height: 1.4;
    }
    .error-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      font-size: 0.875rem;
      padding: 0.75rem;
      border-radius: 0.5rem;
      margin-bottom: 1.25rem;
      text-align: left;
    }
    .form-group {
      text-align: left;
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: #cbd5e1;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    input[type="password"], input[type="text"] {
      width: 100%;
      padding: 0.75rem 1rem;
      background: #0f172a;
      border: 1px solid #475569;
      border-radius: 0.5rem;
      color: #f8fafc;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25);
    }
    input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-submit {
      width: 100%;
      padding: 0.875rem;
      background: #0284c7;
      color: #ffffff;
      border: none;
      border-radius: 0.5rem;
      font-size: 0.9375rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: background-color 0.2s, transform 0.1s;
    }
    .btn-submit:hover:not(:disabled) {
      background: #0369a1;
    }
    .btn-submit:active:not(:disabled) {
      transform: scale(0.98);
    }
    .btn-submit:disabled {
      background: #475569;
      cursor: not-allowed;
      opacity: 0.6;
    }
    .footer {
      margin-top: 1.5rem;
      font-size: 0.75rem;
      color: #64748b;
    }
  </style>
</head>
<body>
  <main class="auth-card">
    <div class="badge">
      <span class="badge-dot"></span>
      Public Preview
    </div>
    <h1>${projectTitle}</h1>
    <p class="subtitle">Enter the password shown in your DevMirror terminal to unlock mobile preview.</p>

    ${errorHtml}

    <form method="POST" action="${PUBLIC_AUTH_ENDPOINT}">
      ${returnToInput}
      <div class="form-group">
        <label for="password">Preview Password</label>
        <input
          type="password"
          id="password"
          name="password"
          required
          autofocus
          autocomplete="current-password"
          placeholder="e.g. dm-7k2p9"
          ${options.isLockedOut ? 'disabled' : ''}
        />
      </div>
      <button type="submit" class="btn-submit" ${options.isLockedOut ? 'disabled' : ''}>
        Unlock Preview
      </button>
    </form>

    <div class="footer">
      Protected by DevMirror Secure Gateway
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
