
import { processPendingDeletionEmails } from '../src/services/emailService';

async function test() {
    console.log("Iniciando procesamiento de correos pendientes...");
    try {
        await processPendingDeletionEmails();
        console.log("Proceso finalizado.");
    } catch (err) {
        console.error("Error:", err);
    }
}

test();
