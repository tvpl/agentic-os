# @mordomo/contracts

The shapes that cross the boundary between the MordomoOS engine, its HTTP API and its interface: the wire types
(`RunRecord`, `RunEvent`, `Approval`...), the settings schema, the typed event map and the write policy. It depends on
`zod` only, so a browser can import it.

`@mordomo/core` re-exports the types a program needs; install this package for the schemas.

```sh
npm install @mordomo/contracts
```

The package is licensed under the [Functional Source License](./LICENSE) (FSL-1.1-ALv2).
