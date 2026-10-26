// Styles for databases, shared by the editor (app theme: html.dark) and the
// public viewer (.fdb-public: the visitor's prefers-color-scheme).

const LIGHT = `
--db-c-gray-bg:#eef0f3;--db-c-gray-fg:#3f4652;
--db-c-brown-bg:#f3e9e2;--db-c-brown-fg:#6b4630;
--db-c-orange-bg:#fdebd8;--db-c-orange-fg:#8a4510;
--db-c-yellow-bg:#fbf1c7;--db-c-yellow-fg:#6e5303;
--db-c-green-bg:#dcf3e4;--db-c-green-fg:#1d6a3a;
--db-c-blue-bg:#dceafc;--db-c-blue-fg:#1d4f91;
--db-c-purple-bg:#ece4fb;--db-c-purple-fg:#5634a0;
--db-c-pink-bg:#fbe3ef;--db-c-pink-fg:#8f2a5c;
--db-c-red-bg:#fde2e1;--db-c-red-fg:#9b2420;`

const DARK = `
--db-c-gray-bg:#2c313a;--db-c-gray-fg:#cfd5df;
--db-c-brown-bg:#3a2d25;--db-c-brown-fg:#e3c2ab;
--db-c-orange-bg:#432a15;--db-c-orange-fg:#f8c18f;
--db-c-yellow-bg:#3d3313;--db-c-yellow-fg:#f2d77b;
--db-c-green-bg:#173626;--db-c-green-fg:#8fdcab;
--db-c-blue-bg:#16294a;--db-c-blue-fg:#9cc3f7;
--db-c-purple-bg:#2b2147;--db-c-purple-fg:#c8b2f6;
--db-c-pink-bg:#3d1c2d;--db-c-pink-fg:#f3a8cb;
--db-c-red-bg:#431c1b;--db-c-red-fg:#f6a6a2;`

export const DB_CSS = `
.fdb{${LIGHT}
  --db-ink:var(--text-1,#0f172a);--db-text:var(--text-2,#475569);--db-mute:var(--text-3,#64748b);
  --db-line:var(--border,#e2e8f0);--db-bg:var(--bg-card,#fff);--db-soft:var(--bg-soft,var(--bg-base,#f8fafc));
  --db-hover:var(--row-hover,rgba(100,116,139,.08));--db-accent:var(--accent,#2563eb);
  --db-accent-soft:var(--accent-soft,rgba(37,99,235,.1));--db-pop:var(--bg-card,#fff);
  --db-input:var(--bg-input,var(--bg-card,#fff));--db-danger:var(--error,#dc2626);
  color:var(--db-ink);font-size:14px;min-width:0}
html.dark .fdb{${DARK}}
.fdb-public{--db-ink:var(--pv-ink);--db-text:var(--pv-text);--db-mute:var(--pv-mute);--db-line:var(--pv-line);
  --db-bg:var(--pv-card);--db-soft:var(--pv-subtle);--db-pop:var(--pv-card);--db-input:var(--pv-card);
  --db-accent:#2563eb;--db-accent-soft:var(--pv-accent-soft);--db-hover:rgba(100,116,139,.08)}
html.dark .fdb-public{${LIGHT}}
@media (prefers-color-scheme: dark){.fdb-public,html.dark .fdb-public{${DARK}}}
.fdb *{box-sizing:border-box}
.fdb button{font:inherit;color:inherit}
.fdb :focus-visible{outline:2px solid var(--db-accent);outline-offset:1px}
.fdb-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0 8px;border-bottom:1px solid var(--db-line);min-width:0}
.fdb-tabs{display:flex;gap:2px;overflow-x:auto;min-width:0;flex:1 1 auto;scrollbar-width:thin}
.fdb-tab{border:none;background:none;padding:6px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;color:var(--db-text);font-weight:600;font-size:13px;display:inline-flex;align-items:center;gap:6px}
.fdb-tab:hover{background:var(--db-hover)}
.fdb-tab[aria-selected="true"]{color:var(--db-ink);box-shadow:inset 0 -2px 0 var(--db-ink);border-radius:6px 6px 0 0}
.fdb-tools{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.fdb-btn{border:1px solid transparent;background:none;padding:5px 9px;border-radius:6px;cursor:pointer;color:var(--db-text);font-size:13px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;min-height:30px}
.fdb-btn:hover{background:var(--db-hover);color:var(--db-ink)}
.fdb-btn[aria-pressed="true"],.fdb-btn.on{color:var(--db-accent);background:var(--db-accent-soft)}
.fdb-btn.primary{background:var(--db-accent);color:#fff;border-color:var(--db-accent)}
.fdb-btn.primary:hover{filter:brightness(1.07);color:#fff}
.fdb-btn.danger{color:var(--db-danger)}
.fdb-btn:disabled{opacity:.5;cursor:default}
.fdb-pop{position:absolute;z-index:4000;background:var(--db-pop);border:1px solid var(--db-line);border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:8px;min-width:220px;max-width:min(420px,calc(100vw - 24px));color:var(--db-ink)}
.fdb-pop h4{margin:2px 4px 8px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--db-mute);font-weight:700}
.fdb-item{display:flex;align-items:center;gap:8px;width:100%;border:none;background:none;text-align:left;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;color:var(--db-ink);min-height:32px}
.fdb-item:hover,.fdb-item:focus-visible{background:var(--db-hover)}
.fdb-item .g{width:18px;text-align:center;color:var(--db-mute);flex-shrink:0}
.fdb-sep{height:1px;background:var(--db-line);margin:6px 0}
.fdb-input,.fdb-select{width:100%;border:1px solid var(--db-line);background:var(--db-input);color:var(--db-ink);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;min-height:32px}
.fdb-select{padding-right:4px}
.fdb-chip{display:inline-flex;align-items:center;gap:4px;border-radius:4px;padding:1px 7px;font-size:12.5px;line-height:20px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.fdb-chips{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.fdb-scroll{overflow:auto;max-width:100%;-webkit-overflow-scrolling:touch}
.fdb-table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:100%}
.fdb-table th,.fdb-table td{border-bottom:1px solid var(--db-line);border-right:1px solid var(--db-line);padding:0;vertical-align:top;background:var(--db-bg)}
.fdb-table th:last-child,.fdb-table td:last-child{border-right:none}
.fdb-table th{position:sticky;top:0;z-index:2;text-align:left;font-weight:600;font-size:12.5px;color:var(--db-text);background:var(--db-soft)}
.fdb-th{position:relative;display:flex;align-items:center;gap:6px;padding:7px 8px;cursor:pointer;user-select:none;min-height:34px;width:100%;border:none;background:none;text-align:left;font-weight:600;color:var(--db-text)}
.fdb-th:hover{background:var(--db-hover)}
.fdb-th .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.fdb-resize{position:absolute;right:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:3;touch-action:none}
.fdb-resize:hover,.fdb-resize.on{background:var(--db-accent);opacity:.5}
.fdb-cell{min-height:34px;padding:6px 8px;font-size:13.5px;overflow:hidden;cursor:text;line-height:1.45;word-break:break-word}
.fdb-cell:hover{background:var(--db-hover)}
.fdb-cell.num{text-align:right;font-variant-numeric:tabular-nums}
.fdb-cell.ro{cursor:default;color:var(--db-mute)}
.fdb-cell.ro:hover{background:none}
.fdb-cell input:not([type=checkbox]),.fdb-cell textarea{width:100%;border:none;outline:2px solid var(--db-accent);border-radius:3px;background:var(--db-input);color:var(--db-ink);font:inherit;padding:2px 4px}
.fdb-titlecell{display:flex;align-items:flex-start;gap:6px}
.fdb-open{opacity:0;border:1px solid var(--db-line);background:var(--db-bg);border-radius:5px;font-size:11.5px;padding:1px 6px;cursor:pointer;color:var(--db-text);white-space:nowrap;flex-shrink:0}
tr:hover .fdb-open,.fdb-open:focus-visible{opacity:1}
@media (hover:none){.fdb-open{opacity:1}}
.fdb-add-row{display:flex;align-items:center;gap:6px;width:100%;border:none;background:none;padding:8px;color:var(--db-mute);cursor:pointer;font-size:13px;text-align:left}
.fdb-add-row:hover{background:var(--db-hover);color:var(--db-ink)}
.fdb-foot td{background:var(--db-soft);font-size:12px;color:var(--db-mute)}
.fdb-foot .fdb-cell{min-height:30px;cursor:pointer}
.fdb-check{width:16px;height:16px;accent-color:var(--db-accent);cursor:pointer;margin:2px 0}
.fdb-board{display:flex;gap:12px;overflow-x:auto;padding:12px 2px 8px;align-items:flex-start;-webkit-overflow-scrolling:touch}
.fdb-col{flex:0 0 272px;max-width:85vw;background:var(--db-soft);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:80px}
.fdb-col.drop{outline:2px dashed var(--db-accent);outline-offset:-2px}
.fdb-col-h{display:flex;align-items:center;gap:6px;padding:2px 4px 4px;font-size:12.5px;color:var(--db-mute)}
.fdb-card{background:var(--db-bg);border:1px solid var(--db-line);border-radius:8px;padding:8px 10px;cursor:grab;display:flex;flex-direction:column;gap:6px;box-shadow:0 1px 2px rgba(15,23,42,.05);text-align:left;width:100%;color:var(--db-ink);touch-action:manipulation}
.fdb-card:hover{border-color:var(--db-mute)}
.fdb-card.dragging{opacity:.4}
.fdb-card .t{font-weight:600;font-size:13.5px;overflow-wrap:anywhere}
.fdb-card .t{padding-right:24px}
.fdb-card .m,.fdb-gbody .m{font-size:12.5px;color:var(--db-text);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.fdb-dropline{height:3px;border-radius:2px;background:var(--db-accent);margin:-2px 0}
.fdb-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr));gap:12px;padding:12px 0}
.fdb-gcard{border:1px solid var(--db-line);border-radius:10px;overflow:hidden;background:var(--db-bg);cursor:pointer;text-align:left;padding:0;display:flex;flex-direction:column;color:var(--db-ink);min-width:0}
.fdb-gcard:hover{box-shadow:0 6px 18px rgba(15,23,42,.1)}
.fdb-gcover{height:120px;background:var(--db-soft) center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:40px}
.fdb-gbody{padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.fdb-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--db-line);border-left:1px solid var(--db-line)}
.fdb-cal-h{font-size:11.5px;color:var(--db-mute);text-align:right;padding:6px 8px;border-right:1px solid var(--db-line);border-bottom:1px solid var(--db-line);background:var(--db-soft);font-weight:600}
.fdb-day{min-height:104px;border-right:1px solid var(--db-line);border-bottom:1px solid var(--db-line);padding:4px;display:flex;flex-direction:column;gap:3px;min-width:0;background:var(--db-bg);position:relative}
.fdb-day.out{background:var(--db-soft)}
.fdb-day.out .d{opacity:.5}
.fdb-day.today .d{background:var(--db-danger);color:#fff;border-radius:999px;padding:0 6px}
.fdb-day.drop{outline:2px dashed var(--db-accent);outline-offset:-3px}
.fdb-day .d{align-self:flex-end;font-size:12px;color:var(--db-text);line-height:20px}
.fdb-day .add{position:absolute;left:4px;top:4px;opacity:0;border:none;background:var(--db-hover);border-radius:4px;cursor:pointer;width:20px;height:20px;color:var(--db-text)}
.fdb-day:hover .add,.fdb-day .add:focus-visible{opacity:1}
.fdb-ev{font-size:12px;border:1px solid var(--db-line);background:var(--db-bg);border-radius:5px;padding:2px 6px;cursor:grab;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;width:100%;color:var(--db-ink);box-shadow:0 1px 1px rgba(15,23,42,.05)}
.fdb-ev:hover{border-color:var(--db-mute)}
.fdb-empty{padding:28px 12px;text-align:center;color:var(--db-mute);font-size:13px}
.fdb-count{font-size:12px;color:var(--db-mute);padding:6px 8px}
.fdb-props{display:grid;grid-template-columns:minmax(110px,180px) minmax(0,1fr);gap:2px 8px;align-items:start;padding:6px 0 10px;border-bottom:1px solid var(--db-line);margin-bottom:8px}
.fdb-props .k{display:flex;align-items:center;gap:6px;color:var(--db-mute);font-size:13px;padding:6px 4px;min-height:34px;overflow:hidden}
.fdb-props .k span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fdb-props .v{min-width:0;border-radius:6px}
.fdb-props .fdb-cell.num{text-align:left}
@media (max-width:640px){
  .fdb-props{grid-template-columns:minmax(90px,38%) minmax(0,1fr)}
  .fdb-day{min-height:64px;padding:2px}
  .fdb-ev{font-size:10.5px;padding:1px 3px}
  .fdb-cal-h{padding:4px 3px;text-align:center}
  .fdb-tab{padding:6px 8px}
}
`
