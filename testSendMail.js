import { sendVerificationEmail } from "./src/services/emailService";

(async () => {
  await sendVerificationEmail("juliagimena00@gmail.com", "123456");
  console.log("Correo de prueba enviado");
})();
