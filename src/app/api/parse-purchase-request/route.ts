import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const runtime = 'nodejs'
export const maxDuration = 60

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')

// 숫자 추출 유틸 (콤마, 원, 만원 등 처리)
function extractNumber(text: string): number {
  const manMatch = text.match(/([\d,]+)\s*만\s*원?/)
  if (manMatch) {
    return parseInt(manMatch[1].replace(/,/g, '')) * 10000
  }
  const numMatch = text.match(/([\d,]+)\s*원?/)
  if (numMatch) {
    return parseInt(numMatch[1].replace(/,/g, ''))
  }
  return 0
}

// Buffer를 Base64로 변환
function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64')
}

// Gemini Vision을 이용한 OCR
async function extractTextWithGemini(buffer: Buffer, fileType: string): Promise<{ text: string; error?: string }> {
  try {
    console.log('Gemini OCR 시작:', { fileType, bufferLength: buffer.length })

    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      console.warn('Google Gemini API 키 없음 - PDF 파싱만 사용')
      return { text: '', error: 'API 키 미설정' }
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const base64Data = bufferToBase64(buffer)

    // 파일 타입에 따른 MIME 타입
    const mimeType = fileType === '.pdf' ? 'application/pdf' : 'image/png'

    const response = await model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      {
        text: '이 문서에서 텍스트를 모두 추출해주세요. 스캔된 문서나 이미지도 정확하게 인식해주세요. 한글, 숫자, 특수문자 모두 포함해서 추출해주세요.',
      },
    ])

    const extractedText = response.response.text()
    console.log('Gemini OCR 완료:', { textLength: extractedText.length })

    return { text: extractedText }
  } catch (err: any) {
    console.error('Gemini OCR 에러:', {
      message: err.message,
      error: err.error?.message || err,
    })
    return { text: '', error: `Gemini OCR 실패: ${err.message}` }
  }
}

// PDF 파싱 (텍스트 기반)
async function extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number; error?: string }> {
  try {
    console.log('PDF 파싱 시작:', { bufferLength: buffer.length })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse')

    const options = {
      max: 0,
      version: 'v1.10.100',
    }

    const data = await pdfParse(buffer, options)

    const text = (data.text || '').trim()
    const pageCount = data.numpages || data.numPages || 0

    console.log('PDF 파싱 성공:', { textLength: text.length, pageCount })

    return { text, pageCount }
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown error'
    console.error('PDF 파싱 에러:', { message: errorMsg })
    return { text: '', pageCount: 0, error: `PDF 파싱 실패: ${errorMsg.substring(0, 100)}` }
  }
}

// 텍스트에서 구매 요청 정보 추출
function extractPurchaseRequestInfo(text: string) {
  const result: Record<string, any> = {}

  // 기업명/공급업체명 추출
  const companyPatterns = [
    /(?:공급업체|공급자|요청\s*기업|납입업체|업체명|회사명|상\s*호)\s*[:\-\s]*([^\n,)(]{2,50})/,
    /(?:기업명|사업|법인명)\s*[:\-\s]*([^\n,)(]{2,50})/,
  ]
  for (const p of companyPatterns) {
    const m = text.match(p)
    if (m) {
      result.company_name = m[1].trim()
      break
    }
  }

  // 품명/구매 품목 추출
  const itemPatterns = [
    /(?:품명|구매\s*품목|구매\s*물품|납입\s*물품|상품명|품\s*목)\s*[:\-\s]*([^\n,()]{3,100})/,
    /(?:구매\s*상품|구매\s*품|물품명)\s*[:\-\s]*([^\n,()]{3,100})/,
  ]
  for (const p of itemPatterns) {
    const m = text.match(p)
    if (m) {
      result.item_name = m[1].trim()
      break
    }
  }

  // 공급가액 추출
  const supplyPatterns = [
    /(?:공급\s*가\s*액|공급가액|공급\s*금액)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/i,
    /공급\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/i,
  ]
  for (const p of supplyPatterns) {
    const m = text.match(p)
    if (m) {
      result.supply_amount = extractNumber(m[1])
      if (result.supply_amount > 0) break
    }
  }

  // 부가세 추출
  const taxPatterns = [
    /(?:부\s*가\s*세|부가세|세금|세액|부가\s*세금)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/i,
  ]
  for (const p of taxPatterns) {
    const m = text.match(p)
    if (m) {
      result.tax_amount = extractNumber(m[1])
      if (result.tax_amount > 0) break
    }
  }

  // 공급가액과 부가세가 모두 없으면 총액에서 찾기 (fallback)
  if (!result.supply_amount && !result.tax_amount) {
    const totalPatterns = [
      /(?:구매\s*금액|구매\s*가격|금액|예정\s*금액|가격|단가|총\s*금액|총액|결제\s*금액|예산|구매\s*예산)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/i,
      /(?:원|가격|금액)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/i,
    ]
    for (const p of totalPatterns) {
      const m = text.match(p)
      if (m) {
        result.supply_amount = extractNumber(m[1])
        if (result.supply_amount > 0) break
      }
    }
  }

  // 목적/사용 목적 추출
  const purposePatterns = [
    /(?:사용\s*목적|목적|용도|사용\s*처|사용\s*용도|구매\s*목적)\s*[:\-\s]*([^\n]{5,200})/,
    /(?:비고|특징|설명|설명서|상세|내용)\s*[:\-\s]*([^\n]{5,200})/,
  ]
  for (const p of purposePatterns) {
    const m = text.match(p)
    if (m) {
      result.purpose = m[1].trim()
      break
    }
  }

  return result
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    }

    console.log('파일 수신:', { name: file.name, size: file.size, type: file.type })

    const buffer = Buffer.from(await file.arrayBuffer())
    let extractedText = ''
    const fileName = file.name.toLowerCase()

    // PDF 처리
    if (fileName.endsWith('.pdf')) {
      console.log('=== PDF 처리 시작 ===')

      // 1단계: 일반 PDF 파싱 시도
      const pdfResult = await extractPdfText(buffer)
      extractedText = pdfResult.text

      if (extractedText.trim().length > 50) {
        console.log('PDF 파싱된 텍스트 충분 - Gemini OCR 스킵')
        const extractedData = extractPurchaseRequestInfo(extractedText)
        return NextResponse.json({
          success: true,
          extractedData,
          rawTextPreview: extractedText.substring(0, 500),
          rawTextLength: extractedText.length,
        })
      }

      // 2단계: 텍스트가 부족하면 Gemini OCR 시도
      console.log('PDF 텍스트 부족 - Gemini OCR 시작')
      const geminiResult = await extractTextWithGemini(buffer, '.pdf')

      if (geminiResult.error) {
        console.error('Gemini OCR 실패:', geminiResult.error)
        // OCR 실패했지만 기존 텍스트 사용
        if (extractedText.trim().length > 0) {
          const extractedData = extractPurchaseRequestInfo(extractedText)
          return NextResponse.json({
            success: true,
            extractedData,
            rawTextPreview: extractedText.substring(0, 500),
            rawTextLength: extractedText.length,
            warning: '기본 PDF 파싱 결과입니다. (OCR 실패)',
          })
        }
        return NextResponse.json({
          success: true,
          extractedData: {},
          rawTextPreview: '',
          warning: 'PDF 파싱 및 OCR 모두 실패. 항목을 직접 입력해주세요.',
        })
      }

      extractedText = geminiResult.text
      console.log('Gemini OCR 텍스트 사용:', { length: extractedText.length })
    }
    // DOCX 처리
    else if (fileName.endsWith('.docx')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mammoth = require('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        extractedText = result.value || ''
        console.log('DOCX 파싱 완료:', extractedText.length, 'chars')
      } catch (docErr: any) {
        console.error('DOCX 파싱 오류:', docErr.message)
        return NextResponse.json({
          success: true,
          extractedData: {},
          rawTextPreview: '',
          warning: 'Word 파일 처리 실패. 항목을 직접 입력해주세요.',
        })
      }
    }
    // 기타 파일 처리
    else if (fileName.endsWith('.doc') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
      try {
        extractedText = buffer.toString('latin1')
          .replace(/[^\x20-\x7E\uAC00-\uD7A3]/g, ' ')
          .replace(/\s+/g, ' ')
      } catch (legacyErr: any) {
        console.error('레거시 파일 처리 오류:', legacyErr.message)
        return NextResponse.json({
          success: true,
          extractedData: {},
          rawTextPreview: '',
          warning: '파일 처리 실패. 항목을 직접 입력해주세요.',
        })
      }
    }
    else {
      return NextResponse.json({ error: '지원하지 않는 파일 형식입니다' }, { status: 400 })
    }

    if (!extractedText || extractedText.trim().length < 5) {
      return NextResponse.json({
        success: true,
        extractedData: {},
        rawTextPreview: extractedText.substring(0, 200),
        warning: '파일에서 텍스트를 추출할 수 없습니다. 항목을 직접 입력해주세요.',
      })
    }

    const extractedData = extractPurchaseRequestInfo(extractedText)

    return NextResponse.json({
      success: true,
      extractedData,
      rawTextPreview: extractedText.substring(0, 500),
      rawTextLength: extractedText.length,
    })
  } catch (err: any) {
    console.error('Parse error 상세:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    })

    return NextResponse.json({
      success: true,
      extractedData: {},
      rawTextPreview: '',
      warning: `분석 중 오류 발생. 항목을 직접 입력해주세요. (${err.message || '알 수 없음'})`,
    })
  }
}
