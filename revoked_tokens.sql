-- ====================================================================
-- TABLA DE REVOCACIÓN DE SESIONES: public.revoked_tokens
-- PROYECTO: Tetería Bodhi (Staging / Production)
-- PROPÓSITO: Mitigar VULN-02 mediante invalidación de tokens en servidor
-- ====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.revoked_tokens (
  token_hash text PRIMARY KEY,
  revoked_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Habilitar y forzar Row Level Security (RLS)
ALTER TABLE public.revoked_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revoked_tokens FORCE ROW LEVEL SECURITY;

-- Revocar acceso a roles no privilegiados
REVOKE ALL ON public.revoked_tokens FROM PUBLIC;
REVOKE ALL ON public.revoked_tokens FROM anon;
REVOKE ALL ON public.revoked_tokens FROM authenticated;

-- Conceder permisos exclusivos al service_role de backend
GRANT ALL ON public.revoked_tokens TO service_role;

-- Política RLS administrativa exclusiva para service_role
DROP POLICY IF EXISTS "service_role_manage_revoked_tokens" ON public.revoked_tokens;
CREATE POLICY "service_role_manage_revoked_tokens"
  ON public.revoked_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Índice optimizado para búsquedas rápidas y purga de expirados
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at
  ON public.revoked_tokens (expires_at);

COMMIT;
