const fs = require('fs');
const nodemailer = require('nodemailer');

async function test() {
    const envFile = fs.readFileSync('.env', 'utf8');
    const env = {};
    envFile.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            let val = values.join('=').trim();
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.substring(1, val.length - 1);
            }
            env[key.trim()] = val;
        }
    });

    try {
        const smtpTransporter = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: parseInt(env.SMTP_PORT || '465', 10),
            secure: parseInt(env.SMTP_PORT || '465', 10) === 465,
            auth: {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS,
            },
        });
        
        console.log("Verifying...", {
            host: env.SMTP_HOST,
            port: parseInt(env.SMTP_PORT || '465', 10),
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
        });
        
        await smtpTransporter.verify();
        console.log("Success!");
    } catch (error) {
        console.error("Error:", error.message);
    }
}

test();
