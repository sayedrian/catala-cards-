"""Rule-based conjugation for regular Catalan -ar verbs and inchoative -ir verbs (-eix-).

Used by build_deck.py for verbs the sheet marks "Model regular" without full tables.
Handles spelling changes (c/qu, g/gu, ç/c, j/g), diaeresis after a vowel (estudiï, construïa)
and pronominal verbs (-se: m'aixeco, aixeca't).
"""
import re

PERSONS = ["jo", "tu", "ell / ella / vostè", "nosaltres", "vosaltres", "ells / elles / vostès"]
VOWELS = "aeiouàèéíòóú"


def _soft(stem):
    """Stem before an ending starting with e/i (spelling change)."""
    for a, b in (("c", "qu"), ("ç", "c"), ("j", "g"), ("g", "gu")):
        if stem.endswith(a):
            return stem[: -len(a)] + b
    return stem


def _join(stem, end):
    """stem + ending; unstressed i after a vowel takes a diaeresis (estudiï, construïa)."""
    if end and end[0] == "i" and stem and stem[-1] in VOWELS and not stem.endswith(("qu", "gu")):
        end = "ï" + end[1:]
    return stem + end


def _ar(inf):
    st = inf[:-2]
    soft = _soft(st)
    pres = [_join(st, "o"), _join(soft, "es"), st + "a", soft + "em", soft + "eu", _join(soft, "en")]
    subj = [_join(soft, e) for e in ("i", "is", "i")] + [soft + "em", soft + "eu", _join(soft, "in")]
    imp = [st + "a", _join(soft, "i"), soft + "em", soft + "eu", _join(soft, "in")]
    impf = [st + e for e in ("ava", "aves", "ava", "àvem", "àveu", "aven")]
    return pres, subj, imp, impf, st + "at", st + "ant"


def _ir(inf):
    st = inf[:-2]
    pres = [st + e for e in ("eixo", "eixes", "eix")] + [_join(st, "im"), _join(st, "iu"), st + "eixen"]
    subj = [st + e for e in ("eixi", "eixis", "eixi")] + [_join(st, "im"), _join(st, "iu"), st + "eixin"]
    imp = [st + "eix", st + "eixi", _join(st, "im"), _join(st, "iu"), st + "eixin"]
    impf = [_join(st, e) for e in ("ia", "ies", "ia")] + [st + "íem", st + "íeu", _join(st, "ien")]
    return pres, subj, imp, impf, _join(st, "it"), st + "int"


PRO = ["em", "et", "es", "ens", "us", "es"]


def _clitic(p, form):
    """Pronoun before a verb form: em + aixeco -> m'aixeco."""
    if p in ("em", "et", "es") and (form[0] in VOWELS or (form[0] == "h" and form[1] in VOWELS)):
        return p[1] + "’" + form
    return p + " " + form


def _enclitic(form, pro):
    """Imperative + pronoun: aixeca + et -> aixeca't, aixequem + nos -> aixequem-nos."""
    full = {"et": "te", "es": "se", "ens": "nos", "us": "vos"}
    if pro in ("et", "es") and form[-1] in VOWELS:
        return form + "’" + pro[1]
    return form + "-" + full.get(pro, pro)


def conjugate(verb):
    """Return (conj dict, participi, gerundi) or None if the verb isn't regular -ar / -ir."""
    v = verb.strip()
    pron = v.endswith("-se")
    inf = v[:-3] if pron else v
    if inf.endswith("ar"):
        pres, subj, imp, impf, part, ger = _ar(inf)
    elif inf.endswith("ir"):
        pres, subj, imp, impf, part, ger = _ir(inf)
    else:
        return None
    fut = [inf + e for e in ("é", "às", "à", "em", "eu", "an")]
    cond = [inf + e for e in ("ia", "ies", "ia", "íem", "íeu", "ien")]
    perf = [a + " " + part for a in ("he", "has", "ha", "hem", "heu", "han")]
    peri = [a + " " + inf for a in ("vaig", "vas", "va", "vam", "vau", "van")]
    conj = {"present": pres, "perfet": perf, "imperfet": impf, "perifrastic": peri,
            "futur": fut, "condicional": cond, "subjuntiu": subj}
    if pron:
        conj = {k: [_clitic(p, f) for p, f in zip(PRO, forms)] for k, forms in conj.items()}
        imp = [_enclitic(f, p) for f, p in zip(imp, ["et", "es", "ens", "us", "es"])]
        ger = _enclitic(ger, "es")
    conj["imperatiu"] = imp
    return conj, part, ger
