SRS(Software Requirements Specification) 구성

IEEE 830, ISO/IEC 29148 같은 표준을 따르기도 하는데, 보통 다음 섹션들이 많이 쓰임
1.	서론 (Introduction)
- 목적 (Purpose)
- 범위 (Scope)
- 정의 및 약어 (Definitions, Acronyms, Abbreviations)
- 참조 문서 (References)
2.	전체 설명 (Overall Description)
- 제품 관점 (Product Perspective) → 시스템 아키텍처, 기존 시스템과 관계
- 제품 기능 요약 (Product Functions)
- 사용자 특성 (User Characteristics)
- 제약 조건 (Constraints: OS, DB, 법규, 표준 준수 등)
- 가정 및 의존성 (Assumptions and Dependencies)
3.	기능 요구사항 (Functional Requirements)
- ID를 붙여 추적 가능하게 작성 (FR-01, FR-02…)
- 표나 Use Case 형식으로 상세히 기술
4.	비기능 요구사항 (Non-functional Requirements)
- 성능 (성능 목표, 처리량, 응답시간)
- 보안 (인증, 암호화, 접근제어)
- 가용성, 확장성, 유지보수성 등
5.	외부 인터페이스 요구사항
- 사용자 인터페이스(UI/UX)
- 하드웨어 인터페이스
- 소프트웨어 인터페이스(API, DB 스키마)
- 통신 인터페이스(프로토콜, 포트 등)
6.	시스템 아키텍처 / 설계 개요 (선택적으로 포함)
- 블록 다이어그램, 데이터 플로우 다이어그램, 시퀀스 다이어그램
7.	요구사항 추적성 매트릭스 (RTM, Requirements Traceability Matrix)
- 요구사항 ↔ 테스트 케이스 매핑
- 나중에 QA/테스트팀이 검증할 때 매우 중요
8.	부록 (Appendices)
- 용어집, 추가 제약사항, 참고 자료

⸻

## 실무에서는 보통?
- 대기업/정부과제/외부 발주: 위의 거의 풀 세트를 작성
- 사내 신규 서비스/스타트업: 3~5번 (기능·비기능 요구사항, 인터페이스)까지만 문서화하고 나머지는 협업 툴(Jira/Confluence/Notion)로 대체
- 애자일 조직: SRS 전체 대신 User Story + Acceptance Criteria를 계속 업데이트하면서 관리

⸻

## 결론
- “공식 문서”로 내야 한다면 제가 위에 쓴 1~8 섹션 정도를 갖춘 SRS 템플릿이 표준입니다.
- 하지만 실제 내부 개발에서는 너무 무겁지 않게, 3~5번까지만 충실히 작성하는 경우가 많습니다.