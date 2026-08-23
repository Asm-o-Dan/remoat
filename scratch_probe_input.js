const http = require('http');
const WebSocket = require('ws');

http.get('http://127.0.0.1:9222/json/list', res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        const targets = JSON.parse(data);
        const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!page) { console.log('No page target'); return; }
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.on('open', () => {
            const expr = `(() => {
                const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], [data-testid*="input"], [data-testid*="chat"]'));
                return inputs.map(el => ({
                    tag: el.tagName,
                    role: el.getAttribute('role') || '',
                    testId: el.getAttribute('data-testid') || '',
                    contentEditable: el.getAttribute('contenteditable') || '',
                    placeholder: el.getAttribute('placeholder') || '',
                    cls: (el.className || '').toString().slice(0, 80),
                    text: (el.textContent || '').trim().slice(0, 40),
                    offsetParent: !!el.offsetParent
                }));
            })()`;
            ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
        });
        ws.on('message', msg => {
            const d = JSON.parse(msg.toString());
            if (d.id === 1) {
                console.log('Live Chat Inputs Found:\n', JSON.stringify(d.result?.result?.value, null, 2));
                ws.close();
            }
        });
    });
});
