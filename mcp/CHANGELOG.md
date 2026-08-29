# Changelog

Verzování dle [semver](https://semver.org/):
- **patch** (`0.2.x`): oprava chování existujícího nástroje, oprava textu
- **minor** (`0.x.0`): nový nástroj nebo nové pole u existujícího, zpětně kompatibilní
- **major** (`x.0.0`): breaking change v signatuře nástroje nebo v tom, co vrací

Bump verze v `mcp/package.json` je zároveň spouštěč releasu — po mergi do `main`
publikuje job `release-mcp` v `.github/workflows/ci.yml` balíček na npm. Verze
v konstruktoru `FastMCP` v `mcp/index.ts` musí sedět, jinak CI failne.

## 0.2.0 — 2026-08-29

První verze publikovaná na npm. `0.1.0` na registry nikdy nebyla — existovala jen
v repu, takže historie balíčku začíná tady.

### Added

- Nástroje pro bankovní integraci a transakce (`bank_integrations`, `bank_transactions`,
  `payment_rule`) — párování plateb z bankovních výpisů.
- `repository`, `homepage` a `bugs` v `package.json`. `repository` je podmínkou
  provenance attestations, které npm generuje při publikaci z CI přes OIDC.
- `publishConfig.access: public`, aby scoped balíček nespadl na pokusu o privátní
  publikaci.

### Fixed

- Odkaz na zdrojový kód v `README.md` mířil na neexistující repozitář.

## 0.1.0 — 2026-06-30

Nepublikováno. Vyčlenění MCP serveru z monorepa do samostatného balíčku se scopem
`@esnerda`: `bin`, `files`, build přes `tsc` do `dist/`. Nástroje pro nemovitosti,
nájemníky, smlouvy a jejich dodatky, tarify, srážky z nájmu, platby, vyúčtování
nákladů a roční rekonciliaci.
