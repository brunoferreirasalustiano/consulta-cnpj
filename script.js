/* UTILITÁRIOS*/
const $ = id => document.getElementById(id);
const fmtDate = d => d ? new Date(d).toLocaleDateString('pt-BR') : 'N/A';
const fmtMoney = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const safe = v => (v === null || v === undefined || v === '') ? null : v;
const fmtCNPJ = c => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/*CACHE (localStorage) */
const CACHE_KEY = 'cnpj_cache_v2_';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function getCache(cnpj) {
    try {
        const raw = localStorage.getItem(CACHE_KEY + cnpj);
        if (!raw) return null;
        const item = JSON.parse(raw);
        if (Date.now() - item.ts > CACHE_TTL) {
            localStorage.removeItem(CACHE_KEY + cnpj);
            return null;
        }
        return item.data;
    } catch { return null; }
}

function setCache(cnpj, data) {
    try {
        localStorage.setItem(CACHE_KEY + cnpj, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
}

/*FILA DE REQUISIÇÕES CNPJ.ws ─  */
class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
        this.minInterval = 25000;
    }
    async add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }
    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        const wait = Math.max(0, this.minInterval - elapsed);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        const { task, resolve, reject } = this.queue.shift();
        this.lastRequestTime = Date.now();
        try { resolve(await task()); } catch (err) { reject(err); }
        finally { this.processing = false; if (this.queue.length > 0) setTimeout(() => this.process(), 0); }
    }
}
const cnpjwsQueue = new RequestQueue();

/* RETRY COM BACKOFF*/
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.status !== 429) return res;
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000;
                console.log(`[Retry] HTTP 429 tentativa ${attempt + 1}. Aguardando ${delay/1000}s...`);
                await new Promise(r => setTimeout(r, delay));
            } else return res;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000;
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError || new Error('Max retries exceeded');
}

/* VALIDAÇÃO CNPJ ─── */
function validateCNPJ(cnpj) {
    cnpj = cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) return { valid: false, msg: "CNPJ deve ter 14 dígitos." };
    if (/^(\d)\1+$/.test(cnpj)) return { valid: false, msg: "CNPJ inválido: dígitos repetidos." };
    let t = cnpj.length - 2, n = cnpj.substring(0, t), d = cnpj.substring(t);
    let s = 0, p = t - 7;
    for (let i = t; i >= 1; i--) { s += n.charAt(t - i) * p--; if (p < 2) p = 9; }
    let r = s % 11 < 2 ? 0 : 11 - (s % 11);
    if (r != d.charAt(0)) return { valid: false, msg: "Dígito verificador incorreto." };
    t++; n = cnpj.substring(0, t); s = 0; p = t - 7;
    for (let i = t; i >= 1; i--) { s += n.charAt(t - i) * p--; if (p < 2) p = 9; }
    r = s % 11 < 2 ? 0 : 11 - (s % 11);
    if (r != d.charAt(1)) return { valid: false, msg: "Dígito verificador incorreto." };
    return { valid: true, cnpj };
}

/*RENDER HELPERS*/
const field = (label, value, full = false) => {
    const v = safe(value);
    return `<div class="field${full ? ' full' : ''}"><label>${label}</label><div class="value${v ? '' : ' na'}">${v || 'N/A'}</div></div>`;
};
const pill = on => on ? '<span class="pill pill-on">Sim</span>' : '<span class="pill pill-off">Não</span>';

/* RENDER INSCRIÇÕES ESTADUAIS */
function renderInscricoesEstaduais(ies, ieError, ieDebugInfo = '') {
    if (ieError) {
        const isRateLimit = ieDebugInfo.includes('429');
        const icon = isRateLimit ? 'fa-clock' : 'fa-exclamation-circle';
        const color = isRateLimit ? '#f59e0b' : '#ef4444';
        const title = isRateLimit ? 'Limite de consultas atingido' : 'CNPJ.ws indisponível';
        const msg = isRateLimit
            ? 'A API pública do CNPJ.ws permite apenas 3 consultas por minuto. O sistema tentou 3x com backoff automático. Aguarde 60 segundos e tente novamente.'
            : 'Não foi possível obter inscrições estaduais. A API pode estar temporariamente indisponível.';
        return `
            <div class="section">
                <div class="section-title"><i class="fas fa-file-invoice"></i> Inscrições Estaduais</div>
                <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;padding:14px 16px;display:flex;align-items:flex-start;gap:10px">
                    <i class="fas ${icon}" style="color:${color};margin-top:2px;font-size:16px;flex-shrink:0"></i>
                    <div>
                        <strong style="color:var(--text);font-size:13px">${title}</strong>
                        <p style="color:var(--text-secondary);font-size:12px;margin-top:4px;line-height:1.5">${msg}</p>
                        ${ieDebugInfo ? `<p style="font-size:10px;color:var(--text-muted);margin-top:6px;font-family:'Courier New',monospace">Debug: ${ieDebugInfo}</p>` : ''}
                    </div>
                </div>
            </div>`;
    }
    if (!ies || ies.length === 0) {
        return `
            <div class="section">
                <div class="section-title"><i class="fas fa-file-invoice"></i> Inscrições Estaduais</div>
                <p style="font-size:13px;color:var(--text-muted);font-style:italic">Nenhuma inscrição estadual encontrada para este estabelecimento.</p>
            </div>`;
    }
    const items = ies.map(ie => `
        <div class="ie-item">
            <span class="ie-uf">${ie.estado?.sigla || ie.estado?.nome || ie.uf || '?'}</span>
            <span class="ie-numero">${ie.inscricao_estadual || ie.inscricao || ie.number || 'N/A'}</span>
            <span class="${ie.ativo ? 'ie-status-on' : 'ie-status-off'}">${ie.ativo ? 'Ativa' : 'Inativa'}</span>
        </div>
    `).join('');
    return `
        <div class="section">
            <div class="section-title"><i class="fas fa-file-invoice"></i> Inscrições Estaduais (${ies.length})</div>
            <div class="ie-list">${items}</div>
            <p class="ie-source-note"><i class="fas fa-circle-info"></i> Fonte: CNPJ.ws · Cadastro Centralizado de Contribuintes</p>
        </div>`;
}

/*RENDER PRINCIPAL*/
function render(data, ieData = null, ieError = false, ieDebugInfo = '') {
    const ativa = data.descricao_situacao_cadastral === 'ATIVA';
    const statusClass = ativa ? 'status-ativa' : 'status-outra';

    return `
    <div class="result-card" id="pdf-content">
        <div class="result-header">
            <div class="company">
                <h2>${data.razao_social}</h2>
                <p class="fantasia">${data.nome_fantasia || 'Sem nome fantasia'}</p>
                <span class="status-badge ${statusClass}">${data.descricao_situacao_cadastral || 'N/A'}</span>
            </div>
            <div class="cnpj-box">
                <div class="lbl">CNPJ</div>
                <div class="val">${fmtCNPJ(data.cnpj)}</div>
            </div>
        </div>

        <div class="section" data-section="identificacao">
            <div class="section-title"><i class="fas fa-id-card"></i> Identificação</div>
            <div class="grid">
                ${field('Matriz/Filial', data.descricao_identificador_matriz_filial)}
                ${field('Natureza Jurídica', data.natureza_juridica)}
                ${field('Porte', data.porte)}
                ${field('Capital Social', fmtMoney(data.capital_social))}
                ${field('Data Início', fmtDate(data.data_inicio_atividade))}
                ${field('Situação', data.descricao_situacao_cadastral)}
                ${field('Data Situação', fmtDate(data.data_situacao_cadastral))}
                ${field('Motivo', data.descricao_motivo_situacao_cadastral)}
                ${field('Qualif. Responsável', data.qualificacao_do_responsavel)}
                ${field('Ente Federativo', data.ente_federativo_responsavel)}
            </div>
        </div>

        <div class="section" data-section="endereco"> 
            <div class="section-title"><i class="fas fa-map-marker-alt"></i> Endereço</div>
            <div class="grid grid-2">
                ${field('Logradouro', `${data.descricao_tipo_de_logradouro || ''} ${data.logradouro || ''}`.trim(), true)}
                ${field('Número', data.numero)}
                ${field('Complemento', data.complemento)}
                ${field('Bairro', data.bairro)}
                ${field('CEP', data.cep)}
                ${field('Município/UF', `${data.municipio || ''}/${data.uf || ''}`)}
                ${field('País', data.pais || 'BRASIL')}
            </div>
        </div>

        <div class="section" data-section="tributacao">
            <div class="section-title"><i class="fas fa-coins"></i> Tributação</div>
            <div class="tributo">
                <span class="tributo-label">Simples Nacional</span>
                ${pill(data.opcao_pelo_simples)}
            </div>
            <div class="tributo-dates">
                <div class="dfield"><label>Data Opção</label><div class="value">${fmtDate(data.data_opcao_pelo_simples)}</div></div>
                <div class="dfield"><label>Data Exclusão</label><div class="value">${fmtDate(data.data_exclusao_do_simples)}</div></div>
            </div>
            <div class="tributo">
                <span class="tributo-label">MEI</span>
                ${pill(data.opcao_pelo_mei)}
            </div>
            <div class="tributo-dates">
                <div class="dfield"><label>Data Opção</label><div class="value">${fmtDate(data.data_opcao_pelo_mei)}</div></div>
                <div class="dfield"><label>Data Exclusão</label><div class="value">${fmtDate(data.data_exclusao_do_mei)}</div></div>
            </div>
        </div>

        <div class="section" data-section="atividades">
            <div class="section-title"><i class="fas fa-briefcase"></i> Atividades</div>
            <div class="cnae-main">
                <span class="cnae-code">${data.cnae_fiscal}</span>
                <span class="cnae-desc">${data.cnae_fiscal_descricao}</span>
            </div>
            ${data.cnaes_secundarios?.length ? `
            <div style="margin-top:12px">
                <div class="section-title" style="margin-bottom:8px"><i class="fas fa-layer-group"></i> Secundárias (${data.cnaes_secundarios.length})</div>
                <div class="cnae-list">
                    ${data.cnaes_secundarios.map(c => `<div class="cnae-item"><span class="code">${c.codigo}</span><span class="desc">${c.descricao}</span></div>`).join('')}
                </div>
            </div>` : ''}
        </div>

        ${renderInscricoesEstaduais(ieData, ieError, ieDebugInfo)}

        <div class="section" data-section="qsa">
            <div class="section-title"><i class="fas fa-users"></i> Quadro Societário (${data.qsa?.length || 0})</div>
            ${data.qsa?.length ? data.qsa.map(s => `
            <div class="socio">
                <div class="socio-name">${s.nome_socio}</div>
                <div class="socio-qual">${s.qualificacao_socio}</div>
                <div class="socio-grid">
                    <div class="sfield"><label>Entrada</label><div class="value">${fmtDate(s.data_entrada_sociedade)}</div></div>
                    <div class="sfield"><label>Faixa Etária</label><div class="value">${safe(s.faixa_etaria) || 'N/A'}</div></div>
                    <div class="sfield"><label>CPF/CNPJ</label><div class="value">${safe(s.cnpj_cpf_do_socio) || 'N/A'}</div></div>
                    <div class="sfield"><label>País</label><div class="value">${safe(s.pais) || 'BRASIL'}</div></div>
                </div>
                ${s.nome_representante_legal ? `<div class="socio-rep"><strong>Representante:</strong> ${s.nome_representante_legal}${s.qualificacao_representante_legal ? ` — ${s.qualificacao_representante_legal}` : ''}</div>` : ''}
            </div>`).join('') : '<p style="color:var(--text-muted);font-size:13px;font-style:italic">Informação não disponível.</p>'}
        </div>

        <div class="section" data-section="contato">
            <div class="section-title"><i class="fas fa-phone"></i> Contato</div>
            <div class="grid">
                ${field('Telefone 1', data.ddd_telefone_1)}
                ${field('Telefone 2', data.ddd_telefone_2)}
                ${field('Fax', data.ddd_fax)}
                ${field('E-mail', data.email)}
            </div>
        </div>
    </div>

    <div class="actions">
        <button class="btn btn-primary" onclick="downloadPDF()">
            <i class="fas fa-file-pdf"></i> Baixar PDF
        </button>
        <button class="btn btn-secondary" onclick="copyData()">
            <i class="fas fa-copy"></i> Copiar JSON
        </button>
    </div>`;
}

/* MÁSCARA INPUT*/
$('cnpj-input').addEventListener('input', e => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 14) v = v.slice(0, 14);
    if (v.length > 12)      v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, '$1.$2.$3/$4-$5');
    else if (v.length > 8)  v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4}).*/, '$1.$2.$3/$4');
    else if (v.length > 5)  v = v.replace(/^(\d{2})(\d{3})(\d{0,3}).*/, '$1.$2.$3');
    else if (v.length > 2)  v = v.replace(/^(\d{2})(\d{0,3}).*/, '$1.$2');
    e.target.value = v;
});

/*BUSCA INSCRIÇÕES ESTADUAIS (CNPJ.ws)*/
async function fetchInscricoesEstaduais(cnpjClean) {
    const cached = getCache('ie_' + cnpjClean);
    if (cached) {
        console.log('[CNPJ.ws] ✅ Cache hit — usando dados locais');
        return { data: cached, error: false, debug: 'Cache local (válido por 7 dias)' };
    }

    return cnpjwsQueue.add(async () => {
        try {
            const res = await fetchWithRetry(`https://publica.cnpj.ws/cnpj/${cnpjClean}`, {}, 3);
            if (!res.ok) {
                const status = res.status;
                const text = await res.text().catch(() => '');
                console.warn(`[CNPJ.ws] HTTP ${status} após retries: ${text}`);
                if (status === 429) {
                    return { data: null, error: true, debug: 'HTTP 429: Too Many Requests — limite de 3 consultas/minuto atingido mesmo após 3 tentativas com backoff (2s, 4s, 8s).' };
                }
                return { data: null, error: true, debug: `HTTP ${status}: ${text || res.statusText}` };
            }
            const json = await res.json();
            console.log('[CNPJ.ws] ✅ Resposta OK');
            console.log('[CNPJ.ws] Chaves de primeiro nível:', Object.keys(json));

            let ieData = null;
            const possiblePaths = [
                { path: 'estabelecimento.inscricoes_estaduais', data: json?.estabelecimento?.inscricoes_estaduais },
                { path: 'inscricoes_estaduais', data: json?.inscricoes_estaduais },
            ];
            for (const p of possiblePaths) {
                if (p.data !== undefined && p.data !== null) {
                    ieData = Array.isArray(p.data) ? p.data : [];
                    console.log(`[CNPJ.ws] 📋 IEs encontradas via ${p.path}: ${ieData.length}`);
                    break;
                }
            }
            if (ieData === null) {
                ieData = [];
                console.log('[CNPJ.ws] ℹ️ Nenhum campo de IE encontrado na resposta');
                console.log('[CNPJ.ws] Estrutura estabelecimento:', json?.estabelecimento ? Object.keys(json.estabelecimento) : 'null');
            }
            setCache('ie_' + cnpjClean, ieData);
            return { data: ieData, error: false, debug: `API OK — ${ieData.length} inscrição(ões)` };
        } catch (err) {
            console.error('[CNPJ.ws] ❌ Erro:', err);
            return { data: null, error: true, debug: `Erro de rede: ${err.message || 'Falha na conexão'}` };
        }
    });
}

/*BUSCA PRINCIPAL*/
async function handleSearch() {
    const raw = $('cnpj-input').value.replace(/\D/g, '');
    const v = validateCNPJ(raw);

    $('error-container').classList.add('hidden');
    $('results-container').classList.add('hidden');
    $('error-container').innerHTML = '';

    if (!v.valid) {
        $('error-container').innerHTML = `<div class="error-box"><i class="fas fa-exclamation-triangle"></i><div><strong>CNPJ Inválido</strong><br>${v.msg}</div></div>`;
        $('error-container').classList.remove('hidden');
        return;
    }

    const cached = getCache(v.cnpj);
    if (cached && cached.brasilAPI) {
        console.log('[Cache] Usando dados em cache');
        $('results-container').innerHTML = render(cached.brasilAPI, cached.ieData, cached.ieError, cached.ieDebug);
        $('results-container').classList.remove('hidden');
        return;
    }

    $('loading').classList.remove('hidden');

    try {
        const [brasilResult, cnpjwsResult] = await Promise.allSettled([
            fetch(`https://brasilapi.com.br/api/cnpj/v1/${v.cnpj}`),
            fetchInscricoesEstaduais(v.cnpj)
        ]);

        if (brasilResult.status === 'rejected') throw new Error('Falha ao conectar com a BrasilAPI.');
        const brasilRes = brasilResult.value;
        if (!brasilRes.ok) {
            if (brasilRes.status === 404) throw new Error('CNPJ não encontrado na base da Receita Federal.');
            if (brasilRes.status === 429) throw new Error('Muitas consultas. Aguarde um momento.');
            throw new Error(`Erro ${brasilRes.status} ao comunicar com a API.`);
        }
        const data = await brasilRes.json();

        let ieData = null, ieError = false, ieDebugInfo = '';
        if (cnpjwsResult.status === 'fulfilled') {
            const ws = cnpjwsResult.value;
            ieData = ws.data; ieError = ws.error; ieDebugInfo = ws.debug;
        } else {
            ieError = true; ieDebugInfo = 'Falha inesperada na consulta CNPJ.ws';
        }

        setCache(v.cnpj, { brasilAPI: data, ieData, ieError, ieDebug: ieDebugInfo, ts: Date.now() });

        $('results-container').innerHTML = render(data, ieData, ieError, ieDebugInfo);
        $('results-container').classList.remove('hidden');
    } catch (err) {
        $('error-container').innerHTML = `<div class="error-box"><i class="fas fa-exclamation-triangle"></i><div><strong>Erro</strong><br>${err.message}</div></div>`;
        $('error-container').classList.remove('hidden');
    } finally {
        $('loading').classList.add('hidden');
    }
}

$('search-btn').addEventListener('click', handleSearch);
$('cnpj-input').addEventListener('keypress', e => { if (e.key === 'Enter') handleSearch(); });

/*PDF — IFRAME + PRINT*/
function downloadPDF() {
    const original = document.getElementById('pdf-content');
    if (!original) return alert('Consulte um CNPJ primeiro.');

    const cnpjNum = $('cnpj-input').value.replace(/\D/g, '');

    const iframe = document.createElement('iframe');
    iframe.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        border: none;
        visibility: hidden;
    `;

    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const win = iframe.contentWindow;

    doc.open();
    doc.write(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>CNPJ ${cnpjNum}</title>

<style>
@page {
    size: A4;
    margin: 12mm;
}

body {
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #111;
}

* {
    box-sizing: border-box;
}

/* EVITA CORTES */
.section {
    page-break-inside: avoid;
    break-inside: avoid;
    margin-bottom: 12px;
}

.field, .ie-item, .socio {
    page-break-inside: avoid;
    break-inside: avoid;
}

/* GRID SIMPLES (mais seguro que CSS grid no print) */
.grid {
    display: table;
    width: 100%;
}

.grid .field {
    display: table-row;
}

.grid .field label,
.grid .field .value {
    display: table-cell;
    padding: 2px 6px;
    border-bottom: 1px solid #eee;
}

/* CABEÇALHO */
.header {
    border-bottom: 2px solid #000;
    margin-bottom: 10px;
    padding-bottom: 6px;
}

/* STATUS */
.status-ativa {
    color: green;
    font-weight: bold;
}

.status-outra {
    color: red;
    font-weight: bold;
}

/* EVITA QUEBRA BRUTA */
h1, h2, h3 {
    page-break-after: avoid;
}

/* REMOVE COISAS QUE QUEBRAM PRINT */
.actions, button {
    display: none !important;
}

</style>

</head>
<body>

${original.outerHTML}

</body>
</html>
    `);

    doc.close();

    setTimeout(() => {
        win.focus();
        win.print();

        setTimeout(() => {
            iframe.remove();
        }, 800);
    }, 300);
}
function buildReceitaStylePDF(original, cnpjNum) {
    const get = (sel) => original.querySelector(sel)?.textContent || 'N/A';

    const razao = get('h2');
    const fantasia = get('.fantasia');
    const status = get('.status-badge');
    const cnpj = get('.cnpj-box .val');

    const field = (label, value) => `
        <tr>
            <td class="label">${label}</td>
            <td class="value">${value}</td>
        </tr>
    `;

    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">

<style>
@page {
    size: A4;
    margin: 15mm;
}

body {
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #111;
}

/* HEADER */
.header {
    border-bottom: 2px solid #1f4e79;
    padding-bottom: 10px;
    margin-bottom: 12px;
}

.header h1 {
    font-size: 15px;
    margin: 0;
}

.header .sub {
    font-size: 12px;
    margin-top: 3px;
    color: #444;
}

.header .meta {
    margin-top: 8px;
    display: flex;
    justify-content: space-between;
    font-size: 12px;
}

/* SEÇÕES */
.section {
    margin-bottom: 10px;
    page-break-inside: avoid;
}

.section-title {
    font-size: 12px;
    font-weight: bold;
    background: #f2f2f2;
    padding: 5px;
    border-left: 4px solid #1f4e79;
    margin-bottom: 5px;
}

/* TABELA LIMPA */
table {
    width: 100%;
    border-collapse: collapse;
}

td {
    border: 1px solid #ddd;
    padding: 5px;
    font-size: 11px;
}

.label {
    width: 40%;
    background: #fafafa;
    font-weight: bold;
}

.footer {
    position: fixed;
    bottom: 0;
    font-size: 9px;
    text-align: center;
    width: 100%;
    color: #666;
}
</style>

</head>

<body>

<div class="header">
    <h1>${razao}</h1>
    <div class="sub">${fantasia}</div>

    <div class="meta">
        <div><b>CNPJ:</b> ${cnpj}</div>
        <div><b>Status:</b> ${status}</div>
    </div>
</div>

<div class="section">
    <div class="section-title">IDENTIFICAÇÃO</div>
    <table>
        ${field('Matriz/Filial', get('[data-section="identificacao"] .field:nth-child(1) .value'))}
        ${field('Natureza Jurídica', get('[data-section="identificacao"] .field:nth-child(2) .value'))}
        ${field('Porte', get('[data-section="identificacao"] .field:nth-child(3) .value'))}
        ${field('Capital Social', get('[data-section="identificacao"] .field:nth-child(4) .value'))}
        ${field('Data Início', get('[data-section="identificacao"] .field:nth-child(5) .value'))}
        ${field('Situação', get('[data-section="identificacao"] .field:nth-child(6) .value'))}
    </table>
</div>

<div class="section">
    <div class="section-title">ENDEREÇO</div>
    <table>
        ${field('Logradouro', get('[data-section="endereco"] .field:nth-child(1) .value'))}
        ${field('Número', get('[data-section="endereco"] .field:nth-child(2) .value'))}
        ${field('Complemento', get('[data-section="endereco"] .field:nth-child(3) .value'))}
        ${field('Bairro', get('[data-section="endereco"] .field:nth-child(4) .value'))}
        ${field('CEP', get('[data-section="endereco"] .field:nth-child(5) .value'))}
        ${field('Município/UF', get('[data-section="endereco"] .field:nth-child(6) .value'))}
    </table>
</div>

<div class="section">
    <div class="section-title">CONTATO</div>
    <table>
        ${field('Telefone 1', get('[data-section="contato"] .field:nth-child(1) .value'))}
        ${field('Telefone 2', get('[data-section="contato"] .field:nth-child(2) .value'))}
        ${field('E-mail', get('[data-section="contato"] .field:nth-child(4) .value'))}
    </table>
</div>

<div class="footer">
    Documento gerado automaticamente · Consulta CNPJ
</div>

</body>
</html>
`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/*COPIAR JSON*/
function copyData() {
    const raw = $('cnpj-input').value.replace(/\D/g, '');
    const data = getCache(raw);
    if (!data || !data.brasilAPI) return alert('Nenhum dado em cache.');
    navigator.clipboard.writeText(JSON.stringify(data.brasilAPI, null, 2))
        .then(() => alert('JSON copiado!'))
        .catch(() => alert('Erro ao copiar.'));
}
/*agradeço a compreenção código complicado kkkk, acho que consegui fazer umas 50 resições por minuto ao inves de 3*/