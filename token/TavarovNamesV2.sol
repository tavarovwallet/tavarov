// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TavarovNames v2 — короткое имя вместо адреса из сорока знаков,
 *                   и сразу с заделом под другие сети.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ ПЕРВОЙ ВЕРСИИ
 *
 *   Ничем в том, что уже работает: claim, release, transferTo, addressOf,
 *   nameOf, isFree, isValid — те же имена и те же правила. Приложение,
 *   написанное под первую версию, работает с этой без единой правки.
 *
 *   Добавлена одна вещь, ради которой всё и затевалось: к имени можно
 *   привязать адреса в сетях, которые к EVM отношения не имеют.
 *
 * ПОЧЕМУ ЭТО ВАЖНО СДЕЛАТЬ СЕЙЧАС, А НЕ ПОТОМ
 *
 *   Все EVM-сети — BNB, Polygon, Arbitrum, Base — используют один и тот же
 *   адрес. Занял имя один раз, и оно работает во всех них разом; отдельно
 *   ничего заводить не нужно.
 *
 *   А вот Tron и Solana устроены иначе: там адрес другой и в 20 байт EVM
 *   он не влезает. Если оставить контракт как был, то в день, когда мы
 *   добавим Tron, пришлось бы разворачивать новый контракт и просить всех
 *   занимать имена заново. Люди бы потеряли имена, а часть — и деньги,
 *   отправленные по старым ссылкам.
 *
 *   Поэтому запись «имя -> адрес» здесь сразу произвольной длины и с
 *   номером сети. Номера берём не с потолка, а по SLIP-44 — тому же
 *   справочнику, которым пользуются все кошельки: 60 — EVM, 195 — Tron,
 *   501 — Solana, 0 — Bitcoin. Добавление сети завтра — это одна строчка
 *   в приложении и ноль изменений в контракте.
 *
 * ЧТО ПРОИСХОДИТ С ЗАПИСЯМИ, ЕСЛИ ИМЯ ОСВОБОДИЛИ
 *
 *   Они перестают действовать в ту же секунду. У каждого имени есть номер
 *   владения, и он растёт при каждом освобождении; записи хранятся вместе с
 *   этим номером. Новый владелец получает чистое имя, а не чужие адреса —
 *   иначе деньги уходили бы предыдущему хозяину.
 *
 * ЧЕГО КОНТРАКТ НЕ УМЕЕТ
 *
 *   Распоряжаться деньгами. У него нет ни одной функции перевода, он не
 *   принимает монеты и у него нет владельца — отобрать имя не можем ни мы,
 *   ни кто-либо ещё.
 */
contract TavarovNames {

    uint256 public constant MIN_LEN = 3;
    uint256 public constant MAX_LEN = 20;

    /// Длина адреса в чужой сети. 128 знаков хватает с большим запасом:
    /// у Solana — 44, у Tron — 34.
    uint256 public constant MAX_REC_LEN = 128;

    /// SLIP-44: этим номером обозначены все EVM-сети разом.
    uint32 public constant EVM = 60;

    mapping(bytes32 => address) private _holder;   // хеш имени -> чей адрес
    mapping(address => string)  private _name;     // адрес -> его имя
    mapping(bytes32 => uint256) private _era;      // хеш имени -> номер владения

    // (имя, номер владения, сеть) -> адрес строкой
    mapping(bytes32 => mapping(uint256 => mapping(uint32 => string))) private _rec;

    event Claimed(address indexed who, string name);
    event Released(address indexed who, string name);
    event Moved(address indexed from, address indexed to, string name);
    event RecordSet(string name, uint32 indexed coinType, string value);

    // ------------------------------------------------------------------
    // Проверка имени
    // ------------------------------------------------------------------

    /**
     * Годится ли имя. Вынесено наружу, чтобы приложение могло сказать
     * «так нельзя» до того, как человек заплатит за операцию.
     *
     * Только a-z, 0-9 и подчёркивание — и это не придирка к красоте, а
     * защита от кражи: русская «а» и латинская «a» на экране неразличимы,
     * и «kоfeinya» с одной русской буквой посередине увело бы деньги
     * чужому. Проверяет сам контракт, а не приложение: приложений может
     * быть много, контракт один.
     */
    function isValid(string memory name) public pure returns (bool) {
        bytes memory b = bytes(name);
        if (b.length < MIN_LEN || b.length > MAX_LEN) return false;
        uint8 first = uint8(b[0]);
        if (first >= 0x30 && first <= 0x39) return false;      // не начинаем с цифры
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            bool ok = (c >= 0x61 && c <= 0x7A)                 // a-z
                   || (c >= 0x30 && c <= 0x39)                 // 0-9
                   || (c == 0x5F);                             // _
            if (!ok) return false;
        }
        return true;
    }

    function _key(string memory name) internal pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    // ------------------------------------------------------------------
    // Кто есть кто
    // ------------------------------------------------------------------

    /// Чей это адрес в EVM-сетях. Нулевой адрес означает, что имя свободно.
    function addressOf(string calldata name) external view returns (address) {
        return _holder[_key(name)];
    }

    /// Как зовут владельца адреса. Пустая строка — имени нет.
    function nameOf(address who) external view returns (string memory) {
        return _name[who];
    }

    /// Свободно ли имя и годится ли оно вообще — одним вопросом.
    function isFree(string calldata name) external view returns (bool) {
        return isValid(name) && _holder[_key(name)] == address(0);
    }

    // ------------------------------------------------------------------
    // Адреса в других сетях
    // ------------------------------------------------------------------

    /**
     * Адрес имени в указанной сети, строкой.
     *
     * Для EVM (60) специально заводить ничего не нужно: если записи нет,
     * возвращается адрес владельца — тот самый, что и в addressOf. Так
     * приложению не нужно знать, EVM это или нет: спрашивает одинаково.
     * Пустая строка означает «в этой сети адреса нет, не отправляйте».
     */
    function recordOf(string calldata name, uint32 coinType) public view returns (string memory) {
        bytes32 k = _key(name);
        string memory v = _rec[k][_era[k]][coinType];
        if (bytes(v).length != 0) return v;
        if (coinType == EVM) {
            address a = _holder[k];
            if (a != address(0)) return _toHex(a);
        }
        return "";
    }

    /// То же самое сразу про несколько сетей — один запрос вместо пяти.
    function recordsOf(string calldata name, uint32[] calldata coinTypes)
        external view returns (string[] memory out)
    {
        out = new string[](coinTypes.length);
        for (uint256 i = 0; i < coinTypes.length; i++) {
            out[i] = recordOf(name, coinTypes[i]);
        }
    }

    /**
     * Записать свой адрес в другой сети. Зовёт владелец имени, за своё имя.
     * Пустая строка стирает запись.
     *
     * Контракт не может проверить, правильный ли это адрес в чужой сети —
     * он её не видит. Проверка на стороне приложения, и она обязательна:
     * ошибка в одном знаке здесь означает деньги в никуда.
     */
    function setRecord(uint32 coinType, string calldata value) external {
        string memory n = _name[msg.sender];
        require(bytes(n).length != 0, "Names: you have no name");
        require(bytes(value).length <= MAX_REC_LEN, "Names: value too long");
        bytes32 k = _key(n);
        _rec[k][_era[k]][coinType] = value;
        emit RecordSet(n, coinType, value);
    }

    // ------------------------------------------------------------------
    // Изменения
    // ------------------------------------------------------------------

    /// Занять свободное имя за собой. Первым пришёл — того и имя.
    function claim(string calldata name) external {
        require(isValid(name), "Names: only a-z 0-9 _ , 3-20, not starting with a digit");
        bytes32 k = _key(name);
        require(_holder[k] == address(0), "Names: already taken");
        require(bytes(_name[msg.sender]).length == 0, "Names: you already have a name");
        _holder[k] = msg.sender;
        _name[msg.sender] = name;
        emit Claimed(msg.sender, name);
    }

    /**
     * Освободить своё имя. Учтите: его тут же может занять кто угодно,
     * и старые ссылки поведут уже к нему. Записи в других сетях при этом
     * перестают действовать — новому владельцу достанется чистое имя.
     */
    function release() external {
        string memory n = _name[msg.sender];
        require(bytes(n).length != 0, "Names: you have no name");
        bytes32 k = _key(n);
        delete _holder[k];
        delete _name[msg.sender];
        _era[k] += 1;                       // старые записи больше не читаются
        emit Released(msg.sender, n);
    }

    /**
     * Переехать на другой свой кошелёк вместе с именем.
     * Одной операцией — значит, между освобождением и занятием нет щели,
     * в которую кто-то успел бы влезть. Записи в других сетях остаются:
     * человек тот же, просто кошелёк новый.
     */
    function transferTo(address newHolder) external {
        require(newHolder != address(0), "Names: new holder is zero");
        require(newHolder != msg.sender, "Names: same address");
        string memory n = _name[msg.sender];
        require(bytes(n).length != 0, "Names: you have no name");
        require(bytes(_name[newHolder]).length == 0, "Names: that address already has a name");
        _holder[_key(n)] = newHolder;
        _name[newHolder] = n;
        delete _name[msg.sender];
        emit Moved(msg.sender, newHolder, n);
    }

    // ------------------------------------------------------------------

    /// Адрес в виде строки «0x…» с обычными маленькими буквами.
    function _toHex(address a) internal pure returns (string memory) {
        bytes20 raw = bytes20(a);
        bytes memory hexd = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            out[2 + i * 2]     = hexd[uint8(raw[i]) >> 4];
            out[3 + i * 2]     = hexd[uint8(raw[i]) & 0x0f];
        }
        return string(out);
    }
}
