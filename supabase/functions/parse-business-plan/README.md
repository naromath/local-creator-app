# parse-business-plan (Supabase Edge Function)

## 1) Secret 설정
```bash
supabase secrets set GOOGLE_GEMINI_API_KEY="YOUR_KEY" --project-ref <PROJECT_REF>
```

선택: 모델 우선순위 지정
```bash
supabase secrets set GEMINI_MODEL="gemini-2.5-flash,gemini-1.5-flash" --project-ref <PROJECT_REF>
```

## 2) 배포
```bash
supabase functions deploy parse-business-plan --project-ref <PROJECT_REF>
```

## 3) 앱 호출
프론트에서 `supabase.functions.invoke('parse-business-plan', { body: formData })`로 호출합니다.
