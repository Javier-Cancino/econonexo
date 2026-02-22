'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  table?: string[][]
  csv?: string
  source?: string
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<'auto' | 'inegi' | 'banxico' | 'shcp'>('auto')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, source }),
      })

      const data = await res.json()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message || 'Error al procesar la solicitud',
        table: data.data?.table,
        csv: data.data?.csv,
        source: data.data?.source,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Error al conectar con el servidor. Verifica tus API Keys en configuración.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const downloadCSV = (csv: string, filename: string = 'datos.csv') => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const renderTable = (table: string[][]) => {
    if (!table || table.length === 0) return null
    return (
      <div className='mt-4 overflow-x-auto rounded-lg border'>
        <table className='min-w-full divide-y divide-gray-200 text-sm'>
          <thead className='bg-gray-50'>
            <tr>
              {table[0].map((header, i) => (
                <th key={i} className='px-4 py-2 text-left font-medium text-gray-700'>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-200 bg-white'>
            {table.slice(1, 21).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className='px-4 py-2 text-gray-600'>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.length > 21 && (
          <p className='bg-gray-50 px-4 py-2 text-xs text-gray-500'>
            Mostrando 20 de {table.length - 1} registros
          </p>
        )}
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-lg'>Cargando...</div>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen flex-col bg-gray-50'>
      <header className='border-b bg-white shadow-sm'>
        <div className='mx-auto flex max-w-5xl items-center justify-between px-4 py-4'>
          <h1 className='text-xl font-bold text-gray-900'>EconoNexo</h1>
          <div className='flex items-center gap-4'>
            <span className='text-sm text-gray-600'>{session?.user?.email}</span>
            <Link
              href='/settings'
              className='rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200'
            >
              Configuración
            </Link>
          </div>
        </div>
      </header>

      <main className='flex flex-1 flex-col'>
        <div className='flex-1 overflow-y-auto p-6'>
          {messages.length === 0 ? (
            <div className='flex h-full flex-col items-center justify-center text-center'>
              <h2 className='text-2xl font-semibold text-gray-800'>¿Qué datos económicos necesitas?</h2>
              <p className='mt-2 max-w-md text-gray-600'>
                Solicita datos de INEGI, Banxico o SHCP. Ejemplos:
              </p>
              <div className='mt-6 space-y-2'>
                {[
                  'Dame el tipo de cambio FIX de Banxico',
                  'PIB de México de INEGI',
                  'Deuda pública del Gobierno Federal de SHCP',
                  'Inflación anual INPC de INEGI',
                ].map((example) => (
                  <button
                    key={example}
                    onClick={() => setInput(example)}
                    className='block w-full rounded-lg border bg-white px-4 py-2 text-left text-sm transition hover:bg-gray-50'
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className='mx-auto max-w-3xl space-y-4'>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-4 ${
                    msg.role === 'user' ? 'ml-12 bg-blue-500 text-white' : 'mr-12 bg-white shadow'
                  }`}
                >
                  <p className='whitespace-pre-wrap'>{msg.content}</p>
                  {msg.table && renderTable(msg.table)}
                  {msg.csv && (
                    <button
                      onClick={() => downloadCSV(msg.csv!)}
                      className='mt-4 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700'
                    >
                      Descargar CSV
                    </button>
                  )}
                  {msg.source && (
                    <p className='mt-2 text-xs text-gray-500'>Fuente: {msg.source}</p>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className='border-t bg-white p-4'>
          <form onSubmit={handleSubmit} className='mx-auto flex max-w-3xl gap-3'>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
              className='rounded-lg border px-3 py-3 text-sm'
            >
              <option value='auto'>Auto</option>
              <option value='inegi'>INEGI</option>
              <option value='banxico'>Banxico</option>
              <option value='shcp'>SHCP</option>
            </select>
            <input
              type='text'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Escribe tu consulta...'
              className='flex-1 rounded-lg border px-4 py-3 focus:border-blue-500 focus:outline-none'
              disabled={loading}
            />
            <button
              type='submit'
              disabled={loading || !input.trim()}
              className='rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 disabled:bg-gray-300'
            >
              {loading ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}