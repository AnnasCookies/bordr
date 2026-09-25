# Bundled fonts

`nerd-core.woff2`, `nerd-icons.woff2` and `nerd-mdi.woff2` are subsets of
**CaskaydiaMono Nerd Font Mono**, itself a patched build of Microsoft's
**Cascadia Code**.

- Cascadia Code — © Microsoft Corporation, [SIL Open Font Licence 1.1](https://scripts.sil.org/OFL)
- Nerd Fonts patching — © Ryan McIntyre, MIT

Only glyphs are included: the subsets carry no Latin text, just the box
drawing, blocks, braille, Powerline separators and icon ranges a terminal
status line is built from. The copyright, licence and licence-URL name
records are preserved in each binary (`--name-IDs='*'`), so the licence
travels with the font as the OFL requires.

Regenerate with `scripts/build-nerd-subset.sh`, which reads a Nerd Font from
the host rather than vendoring the 2.9MB original.

Built from **Nerd Fonts 3.5.0** (`CaskaydiaMonoNerdFontMono-Regular.ttf`, "Version 2407.024;
Nerd Fonts 3.5.0"). 3.5.0 is the first release whose Codicons carry the Claude (U+EC82)
and OpenAI (U+EC81) logos, which is why the icons range runs to U+ECFF.
