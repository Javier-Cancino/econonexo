'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface ApiKeyInfo {
  id: string
  provider: string
  createdAt: string
}

const providers = [
  { id: 'openai', name: 'OpenAI', description: 'GPT-4, GPT-3.5', placeholder: 'sk-...' },
  { id: 'google', name: 'Google AI', description: 'Gemini', placeholder: 'AIza...' },
  { id: 'groq', name: 'Groq', description: 'Llama, Mixtral', placeholder: 'gsk_...' },
  { id: 'inegi', name: 'INEGI', description: 'Token de API INEGI', placeholder: 'Token INEGI' },
  { id: 'banxico', name: 'Banxico', description: 'Token SIE Banxico', placeholder: 'Token Banxico' },
]

export default function SettingsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [savedKeys, setSavedKeys] = useState<ApiKeyInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [keyValues, setKeyValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  useEffect(() => {
    async function fetchKeys() {
      try {
        const res = await fetch('/api/keys')
        const data = await res.json()
        setSavedKeys(data.apiKeys || [])
      } catch (error) {
        console.error('Error fetching keys:', error)
      } finally {
        setLoading(false)
      }
    }

    if (status === 'authenticated') {
      fetchKeys()
    }
  }, [status])

  const hasKey = (provider: string) => savedKeys.some((k) => k.provider === provider)

  const saveKey = async (provider: string) => {
    const key = keyValues[provider]
    if (!key) return

    setSaving(provider)
    try {
      await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      })

      const res = await fetch('/api/keys')
      const data = await res.json()
      setSavedKeys(data.apiKeys || [])
      setKeyValues((prev) => ({ ...prev, [provider]: '' }))
    } catch (error) {
      console.error('Error saving key:', error)
    } finally {
      setSaving(null)
    }
  }

  const deleteKey = async (provider: string) => {
    try {
      await fetch('/api/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      setSavedKeys((prev) => prev.filter((k) => k.provider !== provider))
    } catch (error) {
      console.error('Error deleting key:', error)
    }
  }

  if (loading || status !== 'authenticated') {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-lg'>Cargando...</div>
      </div>
    )
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <header className='border-b bg-white shadow-sm'>
        <div className='mx-auto flex max-w-3xl items-center justify-between px-4 py-4'>
          <h1 className='text-xl font-bold text-gray-900'>EconoNexo</h1>
          <Link
            href='/'
            className='rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700'
          >
            Volver al Chat
          </Link>
        </div>
      </header>

      <main className='mx-auto max-w-3xl px-4 py-8'>
        <h2 className='mb-6 text-2xl font-bold text-gray-900'>Configuración de API Keys</h2>

        <div className='space-y-4'>
          <div className='rounded-lg border bg-white p-4'>
            <h3 className='mb-3 font-semibold text-gray-700'>LLM Providers</h3>
            <div className='space-y-3'>
              {providers
                .filter((p) => ['openai', 'google', 'groq'].includes(p.id))
                .map((provider) => (
                  <div key={provider.id} className='flex items-center gap-3'>
                    <div className='w-32'>
                      <span className='font-medium'>{provider.name}</span>
                      <span className='block text-xs text-gray-500'>{provider.description}</span>
                    </div>
                    <input
                      type='password'
                      placeholder={provider.placeholder}
                      value={keyValues[provider.id] || ''}
                      onChange={(e) =>
                        setKeyValues((prev) => ({ ...prev, [provider.id]: e.target.value }))
                      }
                      className='flex-1 rounded-lg border px-3 py-2 text-sm'
                    />
                    {hasKey(provider.id) ? (
                      <div className='flex gap-2'>
                        <span className='rounded bg-green-100 px-2 py-1 text-xs text-green-700'>
                          Guardado
                        </span>
                        <button
                          onClick={() => deleteKey(provider.id)}
                          className='rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200'
                        >
                          Eliminar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => saveKey(provider.id)}
                        disabled={saving === provider.id || !keyValues[provider.id]}
                        className='rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300'
                      >
                        {saving === provider.id ? 'Guardando...' : 'Guardar'}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>

          <div className='rounded-lg border bg-white p-4'>
            <h3 className='mb-3 font-semibold text-gray-700'>Fuentes de Datos</h3>
            <div className='space-y-3'>
              {providers
                .filter((p) => ['inegi', 'banxico'].includes(p.id))
                .map((provider) => (
                  <div key={provider.id} className='flex items-center gap-3'>
                    <div className='w-32'>
                      <span className='font-medium'>{provider.name}</span>
                      <span className='block text-xs text-gray-500'>{provider.description}</span>
                    </div>
                    <input
                      type='password'
                      placeholder={provider.placeholder}
                      value={keyValues[provider.id] || ''}
                      onChange={(e) =>
                        setKeyValues((prev) => ({ ...prev, [provider.id]: e.target.value }))
                      }
                      className='flex-1 rounded-lg border px-3 py-2 text-sm'
                    />
                    {hasKey(provider.id) ? (
                      <div className='flex gap-2'>
                        <span className='rounded bg-green-100 px-2 py-1 text-xs text-green-700'>
                          Guardado
                        </span>
                        <button
                          onClick={() => deleteKey(provider.id)}
                          className='rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200'
                        >
                          Eliminar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => saveKey(provider.id)}
                        disabled={saving === provider.id || !keyValues[provider.id]}
                        className='rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300'
                      >
                        {saving === provider.id ? 'Guardando...' : 'Guardar'}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>

          <div className='rounded-lg bg-amber-50 p-4'>
            <p className='text-sm text-amber-700'>
              <strong>Nota:</strong> SHCP no requiere API key. Los datos se obtienen directamente
              de datos.gob.mx
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}