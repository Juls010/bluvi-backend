import nodemailer from 'nodemailer';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Carga las variables de entorno desde el archivo .env principal
dotenv.config();

let supabase: SupabaseClient | null = null;

const getSupabaseClient = () => {
    if (supabase) return supabase;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY no configuradas');
    }

    supabase = createClient(url, key);
    return supabase;
};

const transporter = nodemailer.createTransport({
    host: "smtp.zoho.eu",
    port: 465,
    secure: true, // true para 465, false para 587 (TLS)
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
                        from: `"Bluvi Team" <${process.env.EMAIL_USER}>`,
                        to: to,
                        subject: "Tu código de verificación de Bluvi",
                        html: `
                        <!DOCTYPE html>
                        <html lang="es">
                        <head>
                            <meta charset="UTF-8" />
                            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
                            <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap" rel="stylesheet"/>
                            <style>
                                @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap');
                            </style>
                            </head>
                            <body style="margin:0; padding:0;">
                                <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
                                    ¡Bienvenido a Bluvi! Para completar tu registro, introduce el código de verificación que encontrarás a continuación.
                                    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
                                </div>
                                <div style="background: #eef2ff; padding: 32px 16px; margin: 0; font-family: 'Manrope', Arial, sans-serif;">
                                <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                                    style="max-width: 460px; margin: 0 auto; background: #ffffff; border-radius: 20px; border: 1px solid #d4d0f5; overflow: hidden; border-collapse: separate;">
                                    <tr>
                                    <td style="background: linear-gradient(135deg, #A5C9FF 0%, #C8C2FF 60%, #FFD5A1 100%); padding: 32px 36px 28px; text-align: center;">
                                        <img src="https://bfwvxoxjvgnrqylvdouv.supabase.co/storage/v1/object/public/bluvi-assets/logo_bluvi.svg"
                                            alt="Bluvi" height="48" style="display: block; margin: 0 auto;" />
                                    </td>
                                    </tr>
                                    <tr>
                                    <td style="padding: 32px 36px 28px; text-align: center;" role="main">
                                        <p style="font-size: 22px; font-weight: 500; color: #26215C; margin: 0 0 8px 0; font-family: 'Manrope', Arial, sans-serif;">¡Bienvenido a Bluvi!</p>
                                        <p style="font-size: 14px; color: #3C3489; line-height: 1.6; margin: 0 0 28px 0;">Para completar tu registro, introduce este código de verificación:</p>
                                        <div role="region" aria-label="Código de verificación"
                                        style="display: inline-block; background: #EEEDFE; border: 1.5px solid #7F77DD; border-radius: 12px; padding: 14px 32px; margin-bottom: 12px;">
                                        <span style="font-size: 28px; font-weight: 500; letter-spacing: 10px; color: #26215C; font-family: 'Manrope', Arial, sans-serif;">${code}</span>
                                        </div>
                                        <p style="font-size: 13px; color: #3C3489; margin: 0 0 24px 0;">Este código caduca en <strong>15 minutos</strong>.</p>
                                        <div style="border-top: 1px solid #E5E8FF; margin-bottom: 20px;"></div>
                                        <p style="font-size: 12px; color: #534AB7; margin: 0;">Si no has intentado registrarte en Bluvi, puedes ignorar este correo.</p>
                                    </td>
                                    </tr>
                                    <tr>
                                    <td style="background: #F7F6FF; padding: 14px 36px; text-align: center; border-top: 1px solid #E5E8FF;">
                                        <p style="font-size: 12px; color: #534AB7; margin: 0;">&copy; ${new Date().getFullYear()} Bluvi &nbsp;&middot;&nbsp; Conectando personas con amor y respeto</p>
                                    </td>
                                    </tr>
                                </table>
                                </div>
                            `,
                });

        console.log("Correo enviado: %s", info.messageId);
    } catch (error) {
        console.error("Error al enviar el email:", error);
    }
};

export const sendAccountDeletionEmail = async (to: string, firstName: string) => {
    
    console.log("*****************************************");
    console.log("ENVIANDO EMAIL DE ELIMINACIÓN A:", to);
    console.log("*****************************************");
        
    try {
        const info = await transporter.sendMail({
            from: `"Bluvi Team" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: "Tu cuenta en Bluvi ha sido eliminada",
            html: `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
                    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap" rel="stylesheet"/>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap');
                    </style>
                </head>
                <body style="margin:0; padding:0;">
                    <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
                        Tu cuenta en Bluvi ha sido eliminada exitosamente.
                        &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
                    </div>
                    <div style="background: #eef2ff; padding: 32px 16px; margin: 0; font-family: 'Manrope', Arial, sans-serif;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                        style="max-width: 460px; margin: 0 auto; background: #ffffff; border-radius: 20px; border: 1px solid #d4d0f5; overflow: hidden; border-collapse: separate;">
                        <tr>
                        <td style="background: linear-gradient(135deg, #A5C9FF 0%, #C8C2FF 60%, #FFD5A1 100%); padding: 32px 36px 28px; text-align: center;">
                            <img src="https://bfwvxoxjvgnrqylvdouv.supabase.co/storage/v1/object/public/bluvi-assets/logo_bluvi.svg"
                                alt="Bluvi" height="48" style="display: block; margin: 0 auto;" />
                        </td>
                        </tr>
                        <tr>
                        <td style="padding: 32px 36px 28px; text-align: center;" role="main">
                            <p style="font-size: 22px; font-weight: 500; color: #26215C; margin: 0 0 8px 0; font-family: 'Manrope', Arial, sans-serif;">Hasta luego, ${firstName}</p>
                            <p style="font-size: 14px; color: #3C3489; line-height: 1.6; margin: 0 0 16px 0;">Tu cuenta en Bluvi ha sido eliminada exitosamente.</p>
                            <p style="font-size: 13px; color: #3C3489; line-height: 1.6; margin: 0 0 28px 0;">Todos tus datos personales, mensajes y preferencias han sido eliminados de nuestros servidores.</p>
                            <div style="background: #F7F6FF; border-left: 4px solid #7F77DD; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                                <p style="font-size: 12px; color: #534AB7; margin: 0;"><strong>Si deseas reactivar tu cuenta:</strong> Podrás registrarte nuevamente con el mismo email en cualquier momento.</p>
                            </div>
                            <div style="border-top: 1px solid #E5E8FF; margin-bottom: 20px;"></div>
                            <p style="font-size: 12px; color: #534AB7; margin: 0;">¡Te esperamos cuando decidas volver! En Bluvi nos importa tu privacidad y seguridad.</p>
                        </td>
                        </tr>
                        <tr>
                        <td style="background: #F7F6FF; padding: 14px 36px; text-align: center; border-top: 1px solid #E5E8FF;">
                            <p style="font-size: 12px; color: #534AB7; margin: 0;">&copy; ${new Date().getFullYear()} Bluvi &nbsp;&middot;&nbsp; Conectando personas con amor y respeto</p>
                        </td>
                        </tr>
                    </table>
                    </div>
                </body>
                </html>
            `,
        });

        console.log("Email de eliminación enviado: %s", info.messageId);
    } catch (error) {
        console.error("Error al enviar email de eliminación:", error);
    }
};

export const processPendingDeletionEmails = async () => {
    console.log("Revisando cola de correos de eliminación...");

    try {
        const supabase = getSupabaseClient();

        const { data: pendingEmails, error } = await supabase
            .from('deleted_users_emails')
            .select('*')
            .eq('status', 'pending');

        if (error) {
            console.error("Error al consultar la tabla de auditoría:", error);
            throw error;
        }

        if (!pendingEmails || pendingEmails.length === 0) {
            console.log("No hay correos de eliminación pendientes.");
            return;
        }

        for (const record of pendingEmails) {
            try {
                await sendAccountDeletionEmail(record.email, record.first_name || 'Usuario');

                const { error: updateError } = await supabase
                    .from('deleted_users_emails')
                    .update({ status: 'sent' })
                    .eq('id', record.id);

                if (updateError) throw updateError;
                
                console.log(`correo de despedida enviado con éxito a: ${record.email}`);
            } catch (mailError) {
                console.error(`Fallo al enviar correo a ${record.email}:`, mailError);
            }
        }
    } catch (error) {
        console.error("Error crítico en el proceso de correos de despedida:", error);
    }
};