# 🔎 Consulta CNPJ

Sistema web para consulta de CNPJs brasileiros em tempo real, exibindo dados cadastrais completos de empresas diretamente de API pública.

## 🚀 Demonstração
🔗 https://brunoferreirasalustiano.github.io/consulta-cnpj/

---

## 📌 Funcionalidades

- Consulta de CNPJ em tempo real
- Exibição de dados completos da empresa:
  - Razão social
  - Nome fantasia
  - Situação cadastral
  - Endereço completo
  - CNAE principal e secundários
  - Quadro societário (QSA)
- Cache local com expiração (TTL de 7 dias)
- Evita requisições repetidas (otimização de performance)
- Interface simples e responsiva
- Feedback de carregamento e erro

---

## ⚙️ Tecnologias utilizadas

- HTML5
- CSS3
- JavaScript (Vanilla)
- API pública de CNPJ
- LocalStorage (cache local)

---

## 🧠 Destaques técnicos

### 🔹 Sistema de Cache (Performance)
Implementação de cache local com expiração automática:

- Reduz chamadas à API
- Melhora velocidade de resposta
- Evita desperdício de requisições

### 🔹 Estrutura de dados
Consumo e tratamento de JSON estruturado contendo:
- dados cadastrais
- sócios
- CNAEs
- status da empresa

### 🔹 UX otimizada
- Feedback visual de carregamento
- Tratamento de erros
- Interface limpa e objetiva

---

## 📦 Como executar localmente

```bash
git clone https://github.com/brunoferreirasalustiano/consulta-cnpj.git
