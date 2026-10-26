/**
 * Drag a workspace file from the right Sidebar's file tree onto the composer
 * and insert the same `@path` reference the `@` picker produces.
 *
 * Mechanism:
 * - A document-level pointer gesture over the shipped file tree's rows
 *   (`[data-files-body] li[data-files-entry][data-files-path]`) drives a small
 *   custom drag; nothing is written into another plugin's DOM.
 * - A root-scope overlay component renders the drag ghost and the composer
 *   highlight.
 * - A session-scope component inside the composer card publishes its card
 *   rectangle plus an insert callback; on release the gesture asks the
 *   composer under the pointer to insert.
 * - Insertion goes through the composer's own service face
 *   (`conversation.input.shell(sessionId).addFiles([reference], [])`), which is
 *   the same path the shipped OS-file drop uses, so the draft shows a real
 *   reference chip with correct spacing.
 */
window.__ModuleLoader__.load({
  id: 'dsh-file-drag',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const VERSION = '1.0.0';
    const LOG = '[dsh-file-drag]';
    const DRAG_THRESHOLD_PX = 6;
    const CLICK_SUPPRESS_MS = 400;
    const ROW_SELECTOR = 'li[data-files-entry][data-files-path]';
    const TREE_BODY_SELECTOR = '[data-files-body]';
    const CARD_SELECTOR = '[data-composer-card]';
    const MENTION_UNSAFE = /[\u0000-\u001f\u007f-\u009f"]/u;

    /** The client root context captured by `apply`; the gesture is browser-wide. */
    let pluginCtx = null;

    // ---------------------------------------------------------------------
    // Diagnostics
    // ---------------------------------------------------------------------

    const warned = new Set();

    /** Log one diagnostic key at most once, so a broken integration never spams. */
    function warn(key, detail) {
      if (warned.has(key)) return;
      warned.add(key);
      console.warn(`${LOG} ${key}${detail === undefined ? '' : `: ${detail}`}`);
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    // ---------------------------------------------------------------------
    // Drag state (module-scoped, observed by the overlay component)
    // ---------------------------------------------------------------------

    const drag = {
      active: false,
      x: 0,
      y: 0,
      path: '',
      kind: 'file',
      label: '',
    };
    let dragVersion = 0;
    const dragListeners = new Set();

    function subscribeDrag(listener) {
      dragListeners.add(listener);
      return () => {
        dragListeners.delete(listener);
      };
    }

    function dragVersionOf() {
      return dragVersion;
    }

    function publishDrag() {
      dragVersion += 1;
      for (const listener of [...dragListeners]) {
        try {
          listener();
        } catch (error) {
          console.error(`${LOG} drag listener failed:`, error);
        }
      }
    }

    function setDrag(patch) {
      Object.assign(drag, patch);
      publishDrag();
    }

    function clearDrag() {
      Object.assign(drag, { active: false, path: '', label: '' });
      publishDrag();
    }

    // ---------------------------------------------------------------------
    // Composer drop zones (one per mounted composer, session-scoped)
    // ---------------------------------------------------------------------

    const zones = new Set();

    function zoneAt(x, y) {
      for (const zone of zones) {
        try {
          if (zone.contains(x, y)) return zone;
        } catch (error) {
          // A zone detached mid-drag must not abort the gesture.
        }
      }
      return undefined;
    }

    // ---------------------------------------------------------------------
    // Path helpers (same grammar as the shipped @ reference formatter)
    // ---------------------------------------------------------------------

    function normalizePath(value) {
      return String(value ?? '').replace(/\\/g, '/');
    }

    function basenameOf(path) {
      const trimmed = normalizePath(path).replace(/\/+$/, '');
      const name = trimmed.split('/').pop();
      return name !== undefined && name !== '' ? name : trimmed;
    }

    function labelOf(path, kind) {
      const name = basenameOf(path);
      return kind === 'directory' ? `${name}/` : name;
    }

    /** Show a path relative to the session workspace when it lives inside it. */
    function relativize(path, cwd) {
      const normalized = normalizePath(path);
      const root = typeof cwd === 'string' ? normalizePath(cwd).replace(/\/+$/, '') : '';
      if (root !== '' && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
      return normalized;
    }

    /**
     * Format one selected path as @ mention text.
     * @returns the mention, or `null` when the editor grammar cannot represent it.
     */
    function formatMention(path, kind) {
      const normalized = normalizePath(path);
      const withFolderSlash = kind === 'directory' ? `${normalized.replace(/\/+$/, '')}/` : normalized;
      if (withFolderSlash === '' || withFolderSlash === '@') return null;
      if (MENTION_UNSAFE.test(withFolderSlash)) return null;
      return /\s/u.test(withFolderSlash) ? `@"${withFolderSlash}"` : `@${withFolderSlash}`;
    }

    // ---------------------------------------------------------------------
    // Insertion
    // ---------------------------------------------------------------------

    /**
     * Insert one file/folder reference into a session's composer draft.
     * Prefers the composer's own reference path, then narrows to public
     * fallbacks. Never throws into React or the pointer handler.
     */
    function insertReference(sessionId, absolutePath, kind, inputActions) {
      const ctx = pluginCtx;
      if (ctx === null) return false;
      try {
        const sessions = ctx.get('sessions');
        const conversation = ctx.get('conversation');
        if (sessions === undefined || conversation === undefined) {
          warn('services-unavailable', 'sessions/conversation are not mounted yet');
          return false;
        }
        if (sessions.binding(sessionId) === undefined) {
          warn('session-not-retained', String(sessionId));
          return false;
        }
        const cwd = sessions.list?.getSnapshot?.().byId?.[sessionId]?.cwd;
        const relative = relativize(absolutePath, cwd);
        const mention = formatMention(relative, kind);
        if (mention === null) {
          warn('path-unsupported', absolutePath);
          return false;
        }
        const reference = {
          source: 'reference',
          ref: mention,
          label: labelOf(relative, kind),
          appearance: kind === 'directory' ? 'folder' : 'file',
          clipboardText: mention,
        };

        const shell = conversation.input?.shell?.(sessionId);
        if (shell !== undefined && shell !== null) {
          if (typeof shell.addFiles === 'function' && shell.addFiles([reference], []) === true) {
            focusComposer(shell);
            return true;
          }
          if (
            typeof shell.insertReference === 'function' &&
            typeof shell.caretSpan === 'function' &&
            shell.snapshot !== undefined
          ) {
            try {
              const span = { ...shell.caretSpan(), draftRev: shell.snapshot.draftRev };
              if (shell.insertReference(reference, span) === true) {
                focusComposer(shell);
                return true;
              }
            } catch (error) {
              warn('insert-reference-failed', messageOf(error));
            }
          }
        }

        if (
          inputActions !== undefined &&
          inputActions !== null &&
          typeof inputActions.captureInsertion === 'function' &&
          typeof inputActions.insertText === 'function' &&
          inputActions.insertText(mention, inputActions.captureInsertion()) === true
        ) {
          return true;
        }

        warn('composer-refused', 'the draft refused the reference (busy or unavailable)');
        return false;
      } catch (error) {
        warn('insert-failed', messageOf(error));
        return false;
      }
    }

    function focusComposer(shell) {
      try {
        shell.focus?.();
      } catch (error) {
        // Focus is a courtesy; the reference is already in the draft.
      }
    }

    // ---------------------------------------------------------------------
    // Components
    // ---------------------------------------------------------------------

    function glyph(kind) {
      if (kind === 'directory') {
        return h(
          'svg',
          {
            className: 'fdr-glyph',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            'aria-hidden': true,
          },
          h('path', {
            d: 'M1.5 3.5h4l1.3 1.6h7.7v7.4H1.5z',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round',
          }),
        );
      }
      return h(
        'svg',
        {
          className: 'fdr-glyph',
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': true,
        },
        h('path', {
          d: 'M3.5 1.5h5l3 3v10h-8z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8.5 1.5v3h3',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      );
    }

    /** Frame-wide drag feedback: the pointer ghost and the composer outline. */
    function DragLayer() {
      React.useSyncExternalStore(subscribeDrag, dragVersionOf);
      if (!drag.active) return null;
      const zone = zoneAt(drag.x, drag.y);
      const rect = zone === undefined ? null : zone.rect();
      return h(
        React.Fragment,
        null,
        rect === null
          ? null
          : h('div', {
              className: 'fdr-ring',
              style: {
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              },
            }),
        h(
          'div',
          {
            className: 'fdr-ghost',
            style: { left: `${drag.x + 14}px`, top: `${drag.y + 12}px` },
          },
          glyph(drag.kind),
          h('span', { className: 'fdr-ghost-name' }, drag.label),
        ),
      );
    }

    /** Publisher inside one composer card: its rectangle and its insert entry point. */
    function ComposerDropZone(props) {
      const sessionId = props.sessionId;
      const inputActions = props.inputActions;
      const anchorRef = React.useRef(null);
      const inputActionsRef = React.useRef(inputActions);
      inputActionsRef.current = inputActions;

      React.useEffect(() => {
        const anchor = anchorRef.current;
        if (anchor === null || sessionId === undefined) return undefined;

        function rect() {
          const element = anchorRef.current;
          if (element === null) return null;
          const card = typeof element.closest === 'function' ? element.closest(CARD_SELECTOR) : null;
          if (card === null) return null;
          const box = card.getBoundingClientRect();
          if (!(box.width > 0) || !(box.height > 0)) return null;
          return {
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            right: box.right,
            bottom: box.bottom,
          };
        }

        const zone = {
          sessionId,
          rect,
          contains(x, y) {
            const box = rect();
            if (box === null) return false;
            return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
          },
          insert(path, kind) {
            return insertReference(sessionId, path, kind, inputActionsRef.current);
          },
        };
        zones.add(zone);
        return () => {
          zones.delete(zone);
        };
      }, [sessionId]);

      return h('span', { ref: anchorRef, className: 'fdr-anchor', 'aria-hidden': true });
    }

    // ---------------------------------------------------------------------
    // Gesture (document-level pointer delegation over the shipped file rows)
    // ---------------------------------------------------------------------

    function installGesture() {
      let gesture = null;
      let suppressClickUntil = 0;

      function startGesture(row, event) {
        const kind = row.getAttribute('data-files-entry');
        if (kind !== 'file' && kind !== 'directory') return undefined;
        const path = row.getAttribute('data-files-path');
        if (path === null || path === '') return undefined;
        return {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          path,
          kind,
          label: labelOf(path, kind),
          started: false,
        };
      }

      function onPointerDown(event) {
        if (event.button !== 0 || event.pointerType === 'touch') return;
        if (gesture !== null) return;
        const target = event.target;
        if (target === null || typeof target.closest !== 'function') return;
        const row = target.closest(ROW_SELECTOR);
        if (row === null || row.closest(TREE_BODY_SELECTOR) === null) return;
        gesture = startGesture(row, event) ?? null;
      }

      function onPointerMove(event) {
        if (gesture === null || event.pointerId !== gesture.pointerId) return;
        if (!gesture.started) {
          const dx = event.clientX - gesture.startX;
          const dy = event.clientY - gesture.startY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
          gesture.started = true;
          setDrag({
            active: true,
            x: event.clientX,
            y: event.clientY,
            path: gesture.path,
            kind: gesture.kind,
            label: gesture.label,
          });
          return;
        }
        setDrag({ x: event.clientX, y: event.clientY });
      }

      function finishGesture(commit, clientX, clientY) {
        const current = gesture;
        gesture = null;
        if (current === null || !current.started) {
          clearDrag();
          return;
        }
        // A started drag must never also activate the row's preview click.
        suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
        clearDrag();
        if (!commit) return;
        const zone = zoneAt(clientX, clientY);
        if (zone !== undefined) zone.insert(current.path, current.kind);
      }

      function onPointerUp(event) {
        if (gesture === null || event.pointerId !== gesture.pointerId) return;
        finishGesture(true, event.clientX, event.clientY);
      }

      function onPointerCancel(event) {
        if (gesture === null || event.pointerId !== gesture.pointerId) return;
        finishGesture(false, event.clientX, event.clientY);
      }

      function onCancel() {
        if (gesture === null) return;
        const started = gesture.started;
        gesture = null;
        if (started) suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
        clearDrag();
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') onCancel();
      }

      function onClickCapture(event) {
        if (Date.now() > suppressClickUntil) return;
        suppressClickUntil = 0;
        event.preventDefault();
        event.stopPropagation();
      }

      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('pointermove', onPointerMove, true);
      document.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('pointercancel', onPointerCancel, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('click', onClickCapture, true);
      window.addEventListener('blur', onCancel);

      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('pointermove', onPointerMove, true);
        document.removeEventListener('pointerup', onPointerUp, true);
        document.removeEventListener('pointercancel', onPointerCancel, true);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('click', onClickCapture, true);
        window.removeEventListener('blur', onCancel);
        gesture = null;
        clearDrag();
      };
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const STYLE = `
.fdr-anchor{display:none}
.fdr-ring{position:fixed;box-sizing:border-box;border:2px solid var(--dsw-alias-brand-primary);border-radius:12px;pointer-events:none;z-index:2147483000}
.fdr-ghost{position:fixed;z-index:2147483001;display:flex;align-items:center;gap:6px;max-width:280px;padding:6px 10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.16);font-size:13px;line-height:1.4;pointer-events:none}
.fdr-ghost-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fdr-glyph{flex:none;color:var(--dsw-alias-label-secondary)}
`;

    function installStyles() {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-file-drag';
      tag.textContent = STYLE;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    const inject = ['slots'];

    function apply(ctx) {
      pluginCtx = ctx;
      console.info(`${LOG} loaded v${VERSION}`);
      ctx.effect(installStyles, `${LOG}: styles`);
      ctx.effect(installGesture, `${LOG}: pointer gesture`);
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'file-drag-ghost', order: 1000 },
          DragLayer,
        ),
      );
      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          { name: 'conversation.input.overlay', id: 'file-drag-zone', order: 1000 },
          ComposerDropZone,
        ),
      );
    }

    const module = { exports: {} };
    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
