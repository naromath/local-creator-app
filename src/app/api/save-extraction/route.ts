import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { extractedText, extractedData, fileName } = body

    if (!extractedText && !extractedData) {
      return NextResponse.json(
        { error: '저장할 내용이 없습니다' },
        { status: 400 }
      )
    }

    // 프로젝트 루트 확인
    const projectRoot = process.cwd()
    const extractionDir = path.join(projectRoot, 'public', 'extractions')
    
    // 디렉토리가 없으면 생성
    if (!fs.existsSync(extractionDir)) {
      fs.mkdirSync(extractionDir, { recursive: true })
    }

    // 파일명 생성 (원본 파일명 기반)
    const baseFileName = fileName 
      ? fileName.replace(/\.[^/.]+$/, '') 
      : `extraction-${Date.now()}`
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    
    // JSON 파일 저장 (추출된 데이터)
    const jsonFileName = `${baseFileName}-${timestamp}.json`
    const jsonFilePath = path.join(extractionDir, jsonFileName)
    
    const jsonContent = {
      fileName,
      extractedAt: new Date().toISOString(),
      sourceFile: fileName,
      data: extractedData || {},
      rawTextLength: extractedText?.length || 0,
      rawTextPreview: extractedText?.substring(0, 1000) || '',
    }

    fs.writeFileSync(jsonFilePath, JSON.stringify(jsonContent, null, 2), 'utf-8')
    console.log('JSON 저장 완료:', jsonFilePath)

    // 마크다운 파일 저장 (원본 텍스트)
    const mdFileName = `${baseFileName}-${timestamp}.md`
    const mdFilePath = path.join(extractionDir, mdFileName)
    
    const mdContent = `# ${baseFileName} - 추출 결과

**추출 날짜**: ${new Date().toLocaleString('ko-KR')}
**원본 파일**: ${fileName}
**텍스트 길이**: ${extractedText?.length || 0} 자

## 추출된 데이터

\`\`\`json
${JSON.stringify(extractedData || {}, null, 2)}
\`\`\`

## 원본 텍스트 (처음 2000자)

\`\`\`
${extractedText?.substring(0, 2000) || '텍스트 없음'}
\`\`\`

${extractedText && extractedText.length > 2000 ? `\n... (${extractedText.length - 2000} 자 생략)\n` : ''}
`

    fs.writeFileSync(mdFilePath, mdContent, 'utf-8')
    console.log('MD 저장 완료:', mdFilePath)

    // CSV 파일 저장 (추출된 데이터)
    const csvFileName = `${baseFileName}-${timestamp}.csv`
    const csvFilePath = path.join(extractionDir, csvFileName)
    
    // CSV 헤더 생성
    const csvHeaders = Object.keys(extractedData || {})
    const csvContent = [
      csvHeaders.join(','),
      csvHeaders.map(key => {
        const value = extractedData?.[key] || ''
        // CSV 이스케이프 처리
        const stringValue = String(value).replace(/"/g, '""')
        return stringValue.includes(',') || stringValue.includes('"') 
          ? `"${stringValue}"` 
          : stringValue
      }).join(',')
    ].join('\n')

    fs.writeFileSync(csvFilePath, csvContent, 'utf-8')
    console.log('CSV 저장 완료:', csvFilePath)

    // 저장된 파일 목록 반환
    return NextResponse.json({
      success: true,
      message: '추출 결과가 저장되었습니다',
      files: {
        json: `/extractions/${jsonFileName}`,
        markdown: `/extractions/${mdFileName}`,
        csv: `/extractions/${csvFileName}`,
      },
      data: {
        extractedData,
        rawTextLength: extractedText?.length || 0,
      },
    })
  } catch (err: any) {
    console.error('저장 에러:', err.message)
    return NextResponse.json(
      { error: `저장 중 오류 발생: ${err.message}` },
      { status: 500 }
    )
  }
}
