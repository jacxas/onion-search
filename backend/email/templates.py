"""
Templates de emails HTML para notificaciones.
"""


def password_reset_email(reset_url: str, email: str) -> str:
    """
    Email para reset de contraseÃ±a.
    """
    return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f4; padding: 2rem; margin: 0; }}
    .container {{ max-width: 600px; margin: 0 auto; background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }}
    h1 {{ color: #00d9ff; margin-top: 0; }}
    .button {{ display: inline-block; padding: 1rem 2rem; background: linear-gradient(90deg, #00d9ff, #0099cc); color: #0f0f1a; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 1.5rem 0; }}
    .warning {{ background: #fff3cd; border-left: 4px solid #ffc107; padding: 1rem; margin: 1.5rem 0; border-radius: 6px; }}
    .footer {{ color: #888; font-size: 0.85rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>ð¡µ¡­ Reset de contraseÃ±a</h1>
    <p>Hola,</p>
    <p>Recibimos una solicitud para resetear la contraseÃ±a de tu cuenta <strong>{email}</strong>.</p>
    
    <a href="{reset_url}" class="button">Resetear contraseÃ±a</a>
    
    <div class="warning">
      âš  Este enlace expira en <strong>1 hora</strong>. Si no solicitaste este reset, ignora este email.
    </div>
    
    <p>Por seguridad, no compartas este enlace con nadie.</p>
    
    <div class="footer">
      <p>Onion Search Admin | <a href="http://localhost:8000" style="color: #00d9ff;">Volver al dashboard</a></p>
    </div>
  </div>
</body>
</html>
"""


def welcome_email(email: str, temp_password: str) -> str:
    """
    Email de bienvenida con contraseÃ±a temporal.
    """
    return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f4; padding: 2rem; margin: 0; }}
    .container {{ max-width: 600px; margin: 0 auto; background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }}
    h1 {{ color: #00d9ff; margin-top: 0; }}
    .code {{ background: #f8f9fa; border: 2px dashed #00d9ff; padding: 1rem; text-align: center; font-size: 1.5rem; font-weight: 700; color: #00d9ff; border-radius: 8px; margin: 1.5rem 0; }}
    .steps {{ background: #e7f3ff; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; }}
    .steps ol {{ margin: 0; padding-left: 1.5rem; }}
    .footer {{ color: #888; font-size: 0.85rem; margin-top: 2rem; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>ð¡µ¡­ Bienvenido a Onion Search Admin</h1>
    <p>Tu cuenta ha sido creada: <strong>{email}</strong></p>
    
    <p>Tu contraseÃ±a temporal es:</p>
    <div class="code">{temp_password}</div>
    
    <div class="steps">
      <strong>PrÃ³ximos pasos:</strong>
      <ol>
        <li>Inicia sesiÃ³n en <a href="http://localhost:8000/admin/login" style="color: #00d9ff;">el dashboard</a></li>
        <li>Cambia tu contraseÃ±a temporal</li>
        <li>Configura 2FA con Google Authenticator (recomendado)</li>
      </ol>
    </div>
    
    <p>Por seguridad, cambia esta contraseÃ±a inmediatamente despuÃ©s de iniciar sesiÃ³n.</p>
    
    <div class="footer">
      <p>Onion Search Engine | Dashboard de administraciÃ³n seguro</p>
    </div>
  </div>
</body>
</html>
"""


def totp_setup_email(email: str, setup_url: str) -> str:
    """
    Email para configurar 2FA.
    """
    return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f4; padding: 2rem; margin: 0; }}
    .container {{ max-width: 600px; margin: 0 auto; background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }}
    h1 {{ color: #00d9ff; margin-top: 0; }}
    .button {{ display: inline-block; padding: 1rem 2rem; background: linear-gradient(90deg, #00d9ff, #0099cc); color: #0f0f1a; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 1.5rem 0; }}
    .info {{ background: #e7f3ff; border-left: 4px solid #00d9ff; padding: 1rem; margin: 1.5rem 0; border-radius: 6px; }}
    .steps {{ background: #f8f9fa; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; }}
    .steps ol {{ margin: 0; padding-left: 1.5rem; }}
    .footer {{ color: #888; font-size: 0.85rem; margin-top: 2rem; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>ð¡µ¡­ Configurar 2FA (Doble factor)</h1>
    <p>Hola <strong>{email}</strong>,</p>
    <p>Se ha solicitado configurar la autenticaciÃ³n de dos factores (2FA) para tu cuenta.</p>
    
    <a href="{setup_url}" class="button">Configurar 2FA</a>
    
    <div class="info">
      â„π El 2FA protege tu cuenta incluso si alguien obtiene tu contraseÃ±a.
    </div>
    
    <div class="steps">
      <strong>CÃ³mo funciona:</strong>
      <ol>
        <li>Descarga Google Authenticator o Authy en tu celular</li>
        <li>EscaneÃ¡ el cÃ³digo QR que aparecerÃ¡</li>
        <li>IngresÃ¡ el cÃ³digo de 6 dÃ¬gitos para verificar</li>
      </ol>
    </div>
    
    <div class="footer">
      <p>Onion Search Admin | Seguridad reforzada</p>
    </div>
  </div>
</body>
</html>
"""
