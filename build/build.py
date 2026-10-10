#!/usr/bin/env python3
"""Genera data/<oposicion>.js a partir de build/<oposicion>/temas.txt y build/<oposicion>/tNN.txt.

Formato de cada archivo de preguntas (bloques separados por línea en blanco).
Una línea «F» hace que las opciones se muestren en el orden escrito (para «todas las anteriores»).
  Q texto de la pregunta
  = respuesta correcta
  - incorrecta
  - incorrecta
  - incorrecta
  E explicación
  R referencia (artículo)

temas.txt: una línea por tema:  id | sig | título | subtítulo | incluye (opcional, separado por comas: opo/tema o opo/tema:ini-fin)
"""
import json, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)


def parse(path, prefix):
    txt = open(path, encoding="utf-8").read().strip()
    out = []
    for n, block in enumerate(re.split(r"\n\s*\n", txt), 1):
        q = {"o": []}; fijo = False; ci = None
        for line in block.strip().split("\n"):
            line = line.rstrip()
            if not line:
                continue
            k, v = line[:1], line[2:].strip()
            if line.strip() == "F": fijo = True; continue
            if k == "Q": q["q"] = v
            elif k == "=": ci = len(q["o"]); q["o"].append(v)
            elif k == "-": q["o"].append(v)
            elif k == "E": q["e"] = v
            elif k == "R": q["r"] = v
            else: raise SystemExit(f"{path} bloque {n}: línea no reconocida: {line}")
        if "q" not in q or len(q["o"]) != 4:
            raise SystemExit(f"{path} bloque {n}: falta pregunta o no hay 4 opciones: {block[:80]}")
        if len(set(q["o"])) != 4:
            raise SystemExit(f"{path} bloque {n}: opciones repetidas")
        if ci is None:
            raise SystemExit(f"{path} bloque {n}: falta la respuesta correcta (=)")
        if fijo:
            o = q["o"]; extra = {"c": ci}
        else:
            o = [q["o"][ci]] + [x for i, x in enumerate(q["o"]) if i != ci]; extra = {}
        d = {"id": f"{prefix}q{n:02d}", "q": q["q"], "o": o, "e": q.get("e", ""), "r": q.get("r", "")}
        d.update(extra)
        out.append(d)
    return out


def build(opo, nombre, sub):
    d = os.path.join(BASE, opo)
    temas = []
    for line in open(os.path.join(d, "temas.txt"), encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        tid, sig, titulo, subt = parts[:4]
        incl = [x.strip() for x in parts[4].split(",") if x.strip()] if len(parts) > 4 else []
        f = os.path.join(d, tid + ".txt")
        ps = parse(f, f"{opo[:3]}{tid}") if os.path.exists(f) else []
        t = {"id": tid, "sig": sig, "titulo": titulo, "sub": subt, "preguntas": ps}
        if incl:
            t["incluye"] = incl
        temas.append(t)
    o = {"id": opo, "nombre": nombre, "sub": sub, "temas": temas}
    js = "/* Generado por build/build.py. No editar a mano. */\nOPOSICIONES.push(" + json.dumps(o, ensure_ascii=False) + ");\n"
    open(os.path.join(ROOT, "data", opo + ".js"), "w", encoding="utf-8").write(js)
    n = sum(len(t["preguntas"]) for t in temas)
    print(f"{opo}: {len(temas)} temas, {n} preguntas propias")


if __name__ == "__main__":
    cfg = json.load(open(os.path.join(BASE, "oposiciones.json"), encoding="utf-8"))
    for c in cfg:
        if len(sys.argv) == 1 or c["id"] in sys.argv[1:]:
            build(c["id"], c["nombre"], c["sub"])
