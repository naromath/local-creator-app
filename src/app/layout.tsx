import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '로컬크리에이터 관리 시스템',
  description: '로컬크리에이터 지원사업 자체 관리 시스템',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
