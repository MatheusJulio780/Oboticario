import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

// Conecta ao Firebase usando a chave protegida do GitHub
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: "oboticario-e8369.firebaseapp.com",
    projectId: "oboticario-e8369"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function calcularDias(dataAlvoISO) {
    if(!dataAlvoISO) return { texto: '--', atrasado: false, dias: 0 };
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const [ano, mes, dia] = dataAlvoISO.split('-');
    const alvo = new Date(ano, mes - 1, dia);
    const diffDays = Math.ceil((alvo - hoje) / (1000 * 60 * 60 * 24));
    return { atrasado: diffDays < 0, dias: diffDays };
}

function somar30Dias(dataISO) {
    if(!dataISO) return null;
    const [ano, mes, dia] = dataISO.split('-');
    const dt = new Date(ano, mes - 1, dia);
    dt.setMonth(dt.getMonth() + 1);
    return dt.toISOString().split('T')[0];
}

async function run() {
    console.log("Iniciando varredura de cobranças...");
    const vSnap = await getDocs(collection(db, "vendas_clientes"));
    const pgSnap = await getDocs(collection(db, "pagamentos_recebidos"));

    const mapClientes = {};

    vSnap.forEach(d => {
        const v = d.data();
        if(!v.venc_cliente) return;
        const valVenda = parseFloat(v.valor_venda) || 0;

        if(!mapClientes[v.cliente]) mapClientes[v.cliente] = { sacolas: {} };
        if(!mapClientes[v.cliente].sacolas[v.cod_pedido]) {
            mapClientes[v.cliente].sacolas[v.cod_pedido] = { req_p1: 0, req_p2: 0, pago_p1: 0, pago_p2: 0, parcelas: v.parcelas||2, venc_base: v.venc_cliente };
        }
        let parc = v.parcelas || 2;
        mapClientes[v.cliente].sacolas[v.cod_pedido].req_p1 += (parc > 1 ? valVenda/parc : valVenda);
        mapClientes[v.cliente].sacolas[v.cod_pedido].req_p2 += (parc > 1 ? valVenda/parc : 0);
    });

    pgSnap.forEach(d => {
        const pg = d.data();
        if(mapClientes[pg.cliente] && mapClientes[pg.cliente].sacolas[pg.cod_pedido]) {
            const s = mapClientes[pg.cliente].sacolas[pg.cod_pedido];
            if(pg.parcela === 1) s.pago_p1 += pg.valor_pago;
            if(pg.parcela === 2) s.pago_p2 += pg.valor_pago;
        }
    });

    const alertas = [];
    for(const c in mapClientes) {
        for(const cod in mapClientes[c].sacolas) {
            const s = mapClientes[c].sacolas[cod];
            const valParcP1 = s.parcelas > 1 ? (s.req_p1 + s.req_p2) / s.parcelas : s.req_p1;
            const p1_ok = s.pago_p1 >= (valParcP1 - 0.1);
            const p2_ok = s.pago_p2 >= (s.req_p2 - 0.1) || s.parcelas === 1;

            if(!p1_ok || !p2_ok) {
                let tDate = p1_ok ? somar30Dias(s.venc_base) : s.venc_base;
                let stat = calcularDias(tDate);
                alertas.push({
                    cliente: c,
                    parcela: p1_ok ? '2ª' : '1ª',
                    val: p1_ok ? (s.req_p2 - s.pago_p2) : (valParcP1 - s.pago_p1),
                    dias: stat.dias,
                    atrasado: stat.atrasado
                });
            }
        }
    }

    const topicoNTFY = "bto_cob_matheus";
    // SUBSTITUA SEU_USUARIO pelo seu nome de usuário real no GitHub
    const appUrl = "https://matheusjulio780.github.io/Oboticario/gerenciamento.html"; 

    for (const a of alertas) {
        if (!a.atrasado && a.dias <= 5 && a.dias >= 0) {
            console.log(`Disparando NTFY para: ${a.cliente}`);
            await fetch(`https://ntfy.sh/${topicoNTFY}`, {
                method: 'POST',
                body: `A ${a.parcela} parcela de ${a.cliente} (R$ ${a.val.toFixed(2)}) vence em ${a.dias === 0 ? 'HOJE!' : a.dias + ' dias'}.`,
                headers: {
                    'Title': 'Cobranca Proxima',
                    'Tags': 'warning,money_with_wings',
                    'Click': appUrl
                }
            });
        }
    }
    console.log("Varredura concluída.");
    process.exit(0);
}

run().catch(console.error);
