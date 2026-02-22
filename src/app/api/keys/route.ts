import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"
import { hash, compare } from "bcryptjs"

function encryptKey(key: string): string {
  return Buffer.from(key).toString("base64")
}

function decryptKey(encryptedKey: string): string {
  return Buffer.from(encryptedKey, "base64").toString("utf-8")
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: { id: true, provider: true, createdAt: true },
  })

  return NextResponse.json({ apiKeys })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { provider, key } = await request.json()

  if (!provider || !key) {
    return NextResponse.json({ error: "Provider and key are required" }, { status: 400 })
  }

  const validProviders = ["openai", "google", "groq", "inegi", "banxico"]
  if (!validProviders.includes(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 })
  }

  const encryptedKey = encryptKey(key)

  const apiKey = await prisma.apiKey.upsert({
    where: {
      userId_provider: {
        userId: session.user.id,
        provider,
      },
    },
    update: { key: encryptedKey },
    create: {
      userId: session.user.id,
      provider,
      key: encryptedKey,
    },
  })

  return NextResponse.json({ success: true, id: apiKey.id })
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { provider } = await request.json()

  await prisma.apiKey.deleteMany({
    where: { userId: session.user.id, provider },
  })

  return NextResponse.json({ success: true })
}

export { decryptKey }
