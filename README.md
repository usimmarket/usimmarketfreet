# freeT PDF Mapping + Generate (Netlify Functions)

## 0) 업로드 구조
- mapping-studio/ (좌표 찍는 툴)
- mappings/mapping.json (좌표 결과 파일을 여기로 업로드)
- netlify/functions/generate.js (서버 PDF 생성)
- template.pdf (원본 신청서 PDF)
- fonts/malgun.ttf (선택: 한글 출력용 폰트)

## 1) mapping-studio 접속
배포 후:
- /mapping-studio/

기본으로 `../template.pdf` 를 불러옵니다.

## 2) 좌표 찍기
- 좌측 필드 선택 -> PDF 위 클릭 -> x/y/page 저장
- 좌표계는 **PDF 포인트 기준(좌하단 원점)** 입니다.

### ✅ 긴 이름 줄바꿈 출력
- 가입자명 칸에는: `subscriber_name_print`
- 예금주명 칸에는: `autopay_holder_print`
를 각각 찍으면 됩니다.

### ✅ 체크박스 매핑(중요)
checkbox는 보통 라디오/셀렉트 값 비교가 필요합니다.

예시:
- `join_type_new` (checkbox)
  - source: `join_type`
  - on_value: `new`

- `customer_type_foreigner` (checkbox)
  - source: `customer_type`
  - on_value: `foreigner`

## 3) generate 함수 호출
POST `/.netlify/functions/generate`

요청 예시:
{
  "data": { ...index.html의 폼 데이터... },
  "templateUrl": "/template.pdf",
  "mappingUrl": "/mappings/mapping.json",
  "fontUrl": "/fonts/malgun.ttf"
}

응답:
{ "pdf_base64": "..." }

## 4) 한글 출력(권장)
`fonts/malgun.ttf` (또는 NotoSansKR 등 TTF) 업로드 후,
generate 호출 시 `fontUrl`을 지정하세요.
