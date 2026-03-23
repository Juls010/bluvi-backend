import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email", 
    port: 587,
    secure: false, 
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS, 
    },
});

export const sendVerificationEmail = async (to: string, code: string) => {
    
    console.log("*****************************************");
    console.log("INTENTANDO ENVIAR EMAIL A:", to);
    console.log("CÓDIGO QUE DEBE USAR EL USUARIO:", code);
    console.log("*****************************************");
        
    try {
        const info = await transporter.sendMail({
        from: '"Bluvi Team 🌊" <no-reply@bluvi.com>',
        to: to,
        subject: "Tu código de verificación de Bluvi",
        html: `
            <div style="font-family: Arial, sans-serif; text-align: center; color: #333;">
            <h2>¡Hola! Gracias por unirte a Bluvi</h2>
            <p>Para completar tu registro, introduce el siguiente código de verificación:</p>
            <h1 style="color: #007bff; letter-spacing: 5px;">${code}</h1>
            <p>Este código caducará en 15 minutos.</p>
            <hr />
            <small>Si no has intentado registrarte en Bluvi, ignora este correo.</small>
            </div>
        `,
        });

        console.log("Correo enviado: %s", info.messageId);
    } catch (error) {
        console.error("Error al enviar el email:", error);
    }
};