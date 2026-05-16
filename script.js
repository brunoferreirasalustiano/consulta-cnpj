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
    if (/^(\d)+$/.test(cnpj)) return { valid: false, msg: "CNPJ inválido: dígitos repetidos." };
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

        <div class="section">
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

        <div class="section">
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

        <div class="section">
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

        <div class="section">
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

        <div class="section">
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

        <div class="section">
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
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden;';
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
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #1a1a1a;
    background: #fff;
    padding: 0;
}
.header {
    border-bottom: 2px solid #2563eb;
    padding-bottom: 12px;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}
.header-left { flex: 1; }
.header h1 {
    font-size: 16pt;
    font-weight: 700;
    color: #111827;
    margin-bottom: 4px;
    word-break: break-word;
}
.header .fantasia {
    font-size: 10pt;
    color: #4b5563;
    margin-bottom: 6px;
}
.header .status {
    display: inline-block;
    font-size: 9pt;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
}
.header .status.ativa { background: #d1fae5; color: #065f46; }
.header .status.inativa { background: #fee2e2; color: #991b1b; }
.header-right { text-align: right; }
.header-right .lbl {
    font-size: 8pt;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.header-right .val {
    font-family: 'Courier New', monospace;
    font-size: 14pt;
    font-weight: 700;
    color: #2563eb;
}
.section {
    margin-bottom: 14px;
    page-break-inside: avoid;
}
.section-title {
    font-size: 9pt;
    font-weight: 700;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 4px;
    margin-bottom: 8px;
}
.grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px 16px;
}
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.field { page-break-inside: avoid; }
.field.full { grid-column: 1 / -1; }
.field label {
    display: block;
    font-size: 7pt;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 1px;
}
.field .value {
    font-size: 10pt;
    color: #1a1a1a;
    font-weight: 500;
    word-break: break-word;
}
.field .value.na { color: #9ca3af; font-style: italic; }
.ie-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.ie-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 8px 12px;
    gap: 12px;
}
.ie-uf {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    font-weight: 700;
    color: #6b7280;
    background: #f3f4f6;
    border-radius: 3px;
    padding: 2px 8px;
    letter-spacing: 0.05em;
    min-width: 34px;
    text-align: center;
}
.ie-numero {
    font-family: 'Courier New', monospace;
    font-size: 10pt;
    color: #1a1a1a;
    font-weight: 500;
    flex: 1;
}
.ie-status-on { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; font-size:8pt; padding:2px 8px; border-radius:100px; font-weight:700; text-transform:uppercase; }
.ie-status-off { background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db; font-size:8pt; padding:2px 8px; border-radius:100px; font-weight:700; text-transform:uppercase; }
.ie-source-note {
    font-size: 8pt;
    color: #9ca3af;
    margin-top: 8px;
    font-style: italic;
}
.cnae-box {
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
}
.cnae-box .code {
    font-family: 'Courier New', monospace;
    font-weight: 700;
    font-size: 10pt;
    color: #2563eb;
    background: #eff6ff;
    padding: 2px 8px;
    border-radius: 3px;
    white-space: nowrap;
}
.cnae-box .desc { font-size: 10pt; color: #1a1a1a; }
.cnae-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
}
.cnae-item {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 3px;
    padding: 6px 10px;
    font-size: 9pt;
    display: flex;
    gap: 8px;
}
.cnae-item .code { font-family: 'Courier New', monospace; color: #6b7280; white-space: nowrap; }
.cnae-item .desc { color: #374151; }
.socio {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 8px;
    page-break-inside: avoid;
}
.socio-name {
    font-size: 10pt;
    font-weight: 700;
    color: #111827;
    text-transform: uppercase;
}
.socio-qual {
    font-size: 8pt;
    color: #2563eb;
    margin-bottom: 6px;
}
.socio-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 12px;
}
.socio-grid .sfield label {
    font-size: 7pt;
    color: #6b7280;
    text-transform: uppercase;
}
.socio-grid .sfield .value {
    font-size: 9pt;
    color: #374151;
    font-family: 'Courier New', monospace;
}
.socio-rep {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid #e5e7eb;
    font-size: 9pt;
    color: #4b5563;
}
.tributo-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 6px;
}
.tributo-label { font-size: 10pt; font-weight: 600; color: #374151; }
.pill {
    display: inline-block;
    font-size: 8pt;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 100px;
    text-transform: uppercase;
}
.pill-on { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
.pill-off { background: #f3f4f6; color: #4b5563; border: 1px solid #d1d5db; }
.tributo-dates {
    display: flex;
    gap: 20px;
    margin: 0 12px 10px;
}
.tributo-dates .dfield label {
    font-size: 7pt;
    color: #6b7280;
    text-transform: uppercase;
}
.tributo-dates .dfield .value {
    font-size: 9pt;
    color: #374151;
    font-family: 'Courier New', monospace;
}
.footer-pdf {
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    font-size: 7pt;
    color: #9ca3af;
    text-align: center;
}
@media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
    ${buildPDFBody(original)}
    <div class="footer-pdf">
        Documento gerado em ${new Date().toLocaleString('pt-BR')} · Consulta CNPJ · Dados via BrasilAPI
    </div>
</body>
</html>`);
    doc.close();

    setTimeout(() => {
        win.focus();
        win.print();
        setTimeout(() => {
            if (iframe.parentNode) document.body.removeChild(iframe);
        }, 1000);
    }, 500);
}

function buildPDFBody(original) {
    const h2 = original.querySelector('h2')?.textContent || '';
    const fantasia = original.querySelector('.fantasia')?.textContent || '';
    const cnpjVal = original.querySelector('.cnpj-box .val')?.textContent || '';
    const statusEl = original.querySelector('.status-badge');
    const statusText = statusEl?.textContent || 'N/A';
    const statusClass = statusEl?.classList.contains('status-ativa') ? 'ativa' : 'inativa';

    const extractFields = (sectionIndex) => {
        const section = original.querySelectorAll('.section')[sectionIndex];
        if (!section) return '';
        const fields = section.querySelectorAll('.field');
        return Array.from(fields).map(f => {
            const lbl = f.querySelector('label')?.textContent || '';
            const val = f.querySelector('.value')?.textContent || 'N/A';
            const isNA = f.querySelector('.value.na') !== null;
            return `<div class="field${f.classList.contains('full') ? ' full' : ''}"><label>${escapeHtml(lbl)}</label><div class="value${isNA ? ' na' : ''}">${escapeHtml(val)}</div></div>`;
        }).join('');
    };

    const cnaeMain = original.querySelector('.cnae-main');
    let cnaeHTML = '';
    if (cnaeMain) {
        const code = cnaeMain.querySelector('.cnae-code')?.textContent || '';
        const desc = cnaeMain.querySelector('.cnae-desc')?.textContent || '';
        cnaeHTML += `<div class="cnae-box"><span class="code">${escapeHtml(code)}</span><span class="desc">${escapeHtml(desc)}</span></div>`;
    }
    const cnaeSec = original.querySelectorAll('.cnae-item');
    if (cnaeSec.length) {
        cnaeHTML += `<div class="cnae-list">${Array.from(cnaeSec).map(c => {
            const code = c.querySelector('.code')?.textContent || '';
            const desc = c.querySelector('.desc')?.textContent || '';
            return `<div class="cnae-item"><span class="code">${escapeHtml(code)}</span><span class="desc">${escapeHtml(desc)}</span></div>`;
        }).join('')}</div>`;
    }

    const socios = original.querySelectorAll('.socio');
    let qsaHTML = '';
    if (socios.length) {
        qsaHTML = Array.from(socios).map(s => {
            const name = s.querySelector('.socio-name')?.textContent || '';
            const qual = s.querySelector('.socio-qual')?.textContent || '';
            const sfields = s.querySelectorAll('.sfield');
            const entrada = sfields[0]?.querySelector('.value')?.textContent || 'N/A';
            const faixa = sfields[1]?.querySelector('.value')?.textContent || 'N/A';
            const cpf = sfields[2]?.querySelector('.value')?.textContent || 'N/A';
            const pais = sfields[3]?.querySelector('.value')?.textContent || 'BRASIL';
            const rep = s.querySelector('.socio-rep')?.textContent || '';
            return `<div class="socio">
                <div class="socio-name">${escapeHtml(name)}</div>
                <div class="socio-qual">${escapeHtml(qual)}</div>
                <div class="socio-grid">
                    <div class="sfield"><label>Entrada</label><div class="value">${escapeHtml(entrada)}</div></div>
                    <div class="sfield"><label>Faixa Etária</label><div class="value">${escapeHtml(faixa)}</div></div>
                    <div class="sfield"><label>CPF/CNPJ</label><div class="value">${escapeHtml(cpf)}</div></div>
                    <div class="sfield"><label>País</label><div class="value">${escapeHtml(pais)}</div></div>
                </div>
                ${rep ? `<div class="socio-rep">${escapeHtml(rep)}</div>` : ''}
            </div>`;
        }).join('');
    } else {
        qsaHTML = '<p style="color:#9ca3af;font-size:10pt;font-style:italic">Informação não disponível.</p>';
    }

    const tributos = original.querySelectorAll('.tributo');
    let tribHTML = '';
    tributos.forEach((t) => {
        const label = t.querySelector('.tributo-label')?.textContent || '';
        const isOn = t.querySelector('.pill-on') !== null;
        const dates = t.nextElementSibling;
        let datesHTML = '';
        if (dates && dates.classList.contains('tributo-dates')) {
            const dfields = dates.querySelectorAll('.dfield');
            datesHTML = `<div class="tributo-dates">${Array.from(dfields).map(d => {
                const dl = d.querySelector('label')?.textContent || '';
                const dv = d.querySelector('.value')?.textContent || 'N/A';
                return `<div class="dfield"><label>${escapeHtml(dl)}</label><div class="value">${escapeHtml(dv)}</div></div>`;
            }).join('')}</div>`;
        }
        tribHTML += `<div class="tributo-row"><span class="tributo-label">${escapeHtml(label)}</span>${isOn ? '<span class="pill pill-on">Sim</span>' : '<span class="pill pill-off">Não</span>'}</div>${datesHTML}`;
    });

    // Inscrições estaduais do DOM
    const ieSection = original.querySelector('.ie-list');
    let ieHTML = '';
    if (ieSection) {
        const ieItems = ieSection.querySelectorAll('.ie-item');
        ieHTML = `<div class="section">
            <div class="section-title">Inscrições Estaduais (${ieItems.length})</div>
            <div class="ie-list">${Array.from(ieItems).map(item => {
                const uf = item.querySelector('.ie-uf')?.textContent || '?';
                const num = item.querySelector('.ie-numero')?.textContent || 'N/A';
                const status = item.querySelector('.ie-status-on, .ie-status-off')?.textContent || 'N/A';
                const isActive = item.querySelector('.ie-status-on') !== null;
                return `<div class="ie-item">
                    <span class="ie-uf">${escapeHtml(uf)}</span>
                    <span class="ie-numero">${escapeHtml(num)}</span>
                    <span class="${isActive ? 'ie-status-on' : 'ie-status-off'}">${escapeHtml(status)}</span>
                </div>`;
            }).join('')}</div>
        </div>`;
    } else {
        const ieErrorBox = original.querySelector('.error-box');
        if (ieErrorBox) {
            ieHTML = `<div class="section"><div class="section-title">Inscrições Estaduais</div><p style="color:#9ca3af;font-size:10pt;font-style:italic">${escapeHtml(ieErrorBox.textContent || 'Indisponível')}</p></div>`;
        }
    }

    return `
<div class="header">
    <div class="header-left">
        <h1>${escapeHtml(h2)}</h1>
        <div class="fantasia">${escapeHtml(fantasia)}</div>
        <span class="status ${statusClass}">${escapeHtml(statusText)}</span>
    </div>
    <div class="header-right">
        <div class="lbl">CNPJ</div>
        <div class="val">${escapeHtml(cnpjVal)}</div>
    </div>
</div>

<div class="section">
    <div class="section-title">Identificação</div>
    <div class="grid grid-3">
        ${extractFields(0)}
    </div>
</div>

<div class="section">
    <div class="section-title">Endereço</div>
    <div class="grid">
        ${extractFields(1)}
    </div>
</div>

<div class="section">
    <div class="section-title">Tributação</div>
    ${tribHTML}
</div>

<div class="section">
    <div class="section-title">Atividades</div>
    ${cnaeHTML}
</div>

${ieHTML}

<div class="section">
    <div class="section-title">Quadro Societário</div>
    ${qsaHTML}
</div>

<div class="section">
    <div class="section-title">Contato</div>
    <div class="grid grid-3">
        ${extractFields(5)}
    </div>
</div>`;
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