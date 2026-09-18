# -*- coding: utf-8 -*-
"""
Вклеивает словари в приложение.

Словарь лежит прямо в файле, а не подгружается со стороны: приложение
должно открываться без интернета и сразу на нужном языке, а не мигать
чужим, пока что-то грузится.

Пропуски не страшны: если перевода нет, приложение показывает русский.
Пустая кнопка хуже, чем кнопка не на том языке.
"""
import json, glob, os, re

SRC = '/home/claude/apk/www/index.html'
HERE = os.path.dirname(os.path.abspath(__file__))
MARK = '/* СЛОВАРЬ ВСТАВЛЯЕТСЯ СЮДА */'
ORDER = ['ru', 'en', 'es', 'tr', 'pt']


def main():
    ru = json.load(open(os.path.join(HERE, 'ru.json'), encoding='utf-8'))
    dicts, report = {}, []
    for code in ORDER:
        path = os.path.join(HERE, code + '.json')
        d = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
        # только те ключи, что реально есть в приложении
        d = {k: v for k, v in d.items() if k in ru}
        dicts[code] = d
        report.append((code, len(d), len(ru)))

    blob = json.dumps(dicts, ensure_ascii=False, separators=(',', ':'))
    line = 'window.__I18N__ = ' + blob + ';'

    s = open(SRC, encoding='utf-8').read()
    start = s.index(MARK)
    end = s.index('\n', start)
    # если словарь уже вставлен — заменяем целиком, а не копим
    tail = s[end + 1:]
    tail = re.sub(r'^window\.__I18N__ = .*?;\n', '', tail, count=1, flags=re.S)
    s = s[:start] + MARK + '\n' + line + '\n' + tail
    open(SRC, 'w', encoding='utf-8').write(s)

    print('вставлено, знаков:', len(line))
    for code, have, total in report:
        mark = 'полный' if have == total else ('%d из %d' % (have, total))
        print('  %-3s %s' % (code, mark))


if __name__ == '__main__':
    main()
