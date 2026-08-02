import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@city-os/ui';
import { initFromCallbackFragment, loginRedirect, getAccessToken } from '../lib/auth';

export function LoginPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (initFromCallbackFragment()) {
      navigate({ to: '/tickets' });
    }
  }, [navigate]);

  useEffect(() => {
    if (getAccessToken()) {
      navigate({ to: '/tickets' });
    }
  }, [navigate]);

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gray-900 px-6">
      <h1 className="mb-2 text-center text-3xl font-bold text-white">City OS Operations</h1>
      <p className="mb-8 text-center text-gray-400">Sign in to access your field operations</p>
      <Button onClick={() => loginRedirect()} size="lg" className="w-full max-w-xs">
        Sign in with City Guard
      </Button>
    </div>
  );
}