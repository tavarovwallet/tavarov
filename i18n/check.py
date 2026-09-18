# -*- coding: utf-8 -*-
"""
Сверяет приложение и словарь.

Ищет две беды:
  1. В приложении есть метка, а в словаре такого ключа нет. Человек увидит
     на экране не надпись, а восьмизначный ключ. Именно так и вылезло
     «K0577DF9A» вместо слова «Язык».
  2. В словаре есть ключ, которого в приложении уже нет. Не страшно, но
     это мусор, и переводчики тратят на него время.

Пропущенные надписи скрипт умеет восстанавливать: русский текст всё ещё
лежит в самой разметке, достаточно его оттуда взять.
"""
import re, json, os, sys

SRC = '/home/claude/apk/www/index.html'
HERE = os.path.dirname(os.path.abspath(__file__))
RU = os.path.join(HERE, 'ru.json')


def main(fix=False):
    s = open(SRC, encoding='utf-8').read()
    ru = json.load(open(RU, encoding='utf-8'))

    used = set(re.findall(r'data-i18n(?:-[-\w]+)?="(k[0-9a-f]{8})"', s))
    used |= set(re.findall(r"\bt\('(k[0-9a-f]{8})'\)", s))

    missing = sorted(used - set(ru))
    unused = sorted(set(ru) - used)

    recovered = {}
    for k in missing:
        # текст элемента с этой меткой всё ещё в разметке
        m = re.search(r'<[a-zA-Z][\w-]*[^<>]*data-i18n="' + k + r'"[^<>]*>([^<>]*)<', s)
        if m and m.group(1).strip():
            recovered[k] = m.group(1).strip()
        else:
            m = re.search(r'data-i18n-(\w+)="' + k + r'"', s)
            if m:
                attr = m.group(1)
                m2 = re.search(r'\b' + attr + r'="([^"]*)"[^<>]*data-i18n-' + attr + '="' + k + '"', s)
                if m2:
                    recovered[k] = m2.group(1)

    print('меток в приложении :', len(used))
    print('ключей в словаре   :', len(ru))
    print('пропущено          :', len(missing))
    print('лишних в словаре   :', len(unused))

    if missing:
        for k in missing:
            print('   ' + k + '  ' + ('-> ' + recovered.get(k, 'ТЕКСТ НЕ НАЙДЕН')))
    if fix and recovered:
        ru.update(recovered)
        json.dump(ru, open(RU, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1, sort_keys=True)
        print('восстановлено и записано:', len(recovered))

    return 1 if (missing and not fix) else 0


if __name__ == '__main__':
    sys.exit(main(fix='--fix' in sys.argv))
