/**
 * Realistic COTTON bulletin with 8 distinct loads (order + field differences preserved).
 * Used as the primary smart-creator regression fixture.
 */
export const COTTON_8_LOADS_RAW = `
ATUALIZAÇÃO DE EMBARQUE COTTON ✅
https://chat.whatsapp.com/AbCdEfGhIjKlMnOp

────────────────────
🚛 ORIGEM: Sapezal/MT
📍 FAZ SAUDADES
➡️ DESTINO: Rondonópolis/MT
🏭 ALG COOPERBEM
📅 JANELA: D+5 ÚTEIS
🚚 VEÍCULO: RODOTREM
🔢 QTD: 2
💰 FRETE: R$ 280,00/TON
📍 https://maps.app.goo.gl/cotton01
🛣 PEDÁGIO INCLUSO NO FRETE

────────────────────
🚛 ORIGEM: Campo Novo do Parecis/MT
📍 FAZ BOA ESPERANÇA
➡️ DESTINO: Paranaguá/PR
🏭 TERMINAL CORREA
📅 JANELA: 15/10/2026
🚚 VEÍCULO: BITREM
🔢 QTD: 1
💰 FRETE: R$ 320,00/TON
📍 https://maps.app.goo.gl/cotton02
🛣 PEDÁGIO NÃO INCLUSO

────────────────────
🚛 ORIGEM: Diamantino/MT
📍 ALG FIBRA NORTE
➡️ DESTINO: Santos/SP
🏭 PORTO SANTOS
📅 JANELA: D+3 ÚTEIS
🚚 VEÍCULO: CARRETA
🔢 QUANTIDADE: 3
💰 FRETE: R$ 410,00/TON
📍 https://maps.app.goo.gl/cotton03
🛣 TAG OK
Obs.: Preferência manhã

────────────────────
🚛 ORIGEM: Lucas do Rio Verde/MT
📍 COOP ALGODOEIRA LV
➡️ DESTINO: Imbituba/SC
📅 JANELA: 20/10 a 22/10
🚚 VEÍCULO: QUARTO EIXO
🔢 QTD: 4
💰 FRETE: R$ 295,50/TON
📍 https://maps.app.goo.gl/cotton04
🛣 PEDÁGIO POR CONTA DO EMBARCADOR

────────────────────
🚛 ORIGEM: Primavera do Leste/MT
📍 FAZ SANTA LUZIA
➡️ DESTINO: Rondonópolis/MT
🏭 ALG COOPERBEM
📅 JANELA: D+7 ÚTEIS
🚚 VEÍCULO: RODOTREM
🔢 QTD: 1
💰 FRETE: R$ 180,00/TON
📍 https://maps.app.goo.gl/cotton05
🛣 PEDÁGIO INCLUSO NO FRETE
Linha avulsa: confirmar balança

────────────────────
🚛 ORIGEM: Sorriso/MT
📍 ARMAZÉM CENTRAL
➡️ DESTINO: Paranaguá/PR
📅 Data: 18/10/2026
🚚 Tipo de veículo: LS
🔢 Veículos: 2
💰 Valor do frete: R$ 350,00/TON
📍 https://maps.app.goo.gl/cotton06
🛣 Pedágio: incluso

────────────────────
🚛 ORIGEM: Nova Mutum/MT
📍 FAZ HORIZONTE
➡️ DESTINO: São Francisco do Sul/SC
🏭 TERMINAL TESC
📅 JANELA: D+5 DIAS
🚚 VEÍCULO: TRITREM
🔢 QTD: 1
💰 FRETE: R$ 370,00/TON
📍 https://maps.app.goo.gl/cotton07
🛣 PEDÁGIO INCLUSO NO FRETE

────────────────────
🚛 ORIGEM: Canarana/MT
📍 ALG LESTE
➡️ DESTINO: Santos/SP
📅 JANELA: Imediato
🚚 VEÍCULO: RODOTREM
🔢 QTD: 5
💰 FRETE: R$ 390,00/TON
📍 https://maps.app.goo.gl/cotton08
🛣 PEDÁGIO NÃO INCLUSO
`.trim();

export function buildNLoadsBulletin(n: number, title = "BOLETIM TESTE"): string {
    const sep = "────────────────────";
    const chunks = [title];
    for (let i = 1; i <= n; i++) {
        chunks.push(
            sep,
            [
                `🚛 ORIGEM: Cidade${i}/MT`,
                `📍 FAZ EXEMPLO ${i}`,
                `➡️ DESTINO: Porto${i}/PR`,
                `🏭 TERMINAL ${i}`,
                `📅 JANELA: D+${(i % 5) + 1} ÚTEIS`,
                `🚚 VEÍCULO: ${i % 2 === 0 ? "RODOTREM" : "CARRETA"}`,
                `🔢 QTD: ${i}`,
                `💰 FRETE: R$ ${200 + i},00/TON`,
                `📍 https://maps.app.goo.gl/load${i}`,
                `🛣 ${i % 3 === 0 ? "PEDÁGIO NÃO INCLUSO" : "PEDÁGIO INCLUSO NO FRETE"}`,
            ].join("\n")
        );
    }
    return chunks.join("\n");
}
