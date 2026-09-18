// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TavarovNames v3 — то же короткое имя вместо адреса, но с тремя вещами,
 *                   которых во второй версии не хватало.
 *
 * ЗАЧЕМ ВООБЩЕ НОВАЯ ВЕРСИЯ
 *
 *   Вторая версия неизменяема и без владельца — это было правильно и
 *   останется правдой: она никуда не девается и продолжает работать. Но у
 *   неё нет трёх вещей, а добавить их в неё нельзя ни при каких условиях.
 *
 *   1. ЗАПРЕТНЫЕ СЛОВА. Сейчас любой человек может бесплатно занять имя
 *      support, admin, binance или tavarov. Это не упущенная выгода, это
 *      способ мошенничества: человек с именем support получает деньги от
 *      тех, кто думает, что платит нам.
 *
 *   2. КОРОТКИЕ ИМЕНА. Три-четыре буквы — это то, что скупают ботами в
 *      первый же день, а потом перепродают. Их надо придержать, пока не
 *      появится честный способ раздать.
 *
 *   3. ЦЕНА, КОТОРОЙ ПОКА НЕТ. Продавать имена сегодня не за что: сети
 *      вокруг них ещё нет, и честная цена — ноль. Но возможность включить
 *      плату позже должна существовать заранее, иначе придётся переезжать
 *      второй раз, а к тому времени имён будут тысячи и часть людей о
 *      переезде не узнает никогда.
 *
 * ПОЧЕМУ НИКОМУ НЕ НУЖНО НИКУДА ПЕРЕЕЗЖАТЬ
 *
 *   Этот контракт ЧИТАЕТ старый. Имя, занятое во второй версии, здесь
 *   отвечает так же, как там, и занять его повторно нельзя. Владельцу
 *   старого имени не нужно делать ничего: ни платить, ни подтверждать, ни
 *   даже знать о существовании третьей версии. Приложение спрашивает
 *   только этот контракт, а он сам сходит в старый, если у себя не нашёл.
 *
 * ЧТО ВЛАДЕЛЕЦ КОНТРАКТА МОЖЕТ И ЧЕГО НЕ МОЖЕТ
 *
 *   Может: объявить слово запретным, назначить запретное слово нашему
 *   официальному адресу, установить цену по длине имени, поменять казну,
 *   отказаться от власти навсегда.
 *
 *   НЕ МОЖЕТ: отобрать занятое имя, передать его другому, освободить
 *   чужое, продлить или сократить чужой срок, забрать деньги из контракта
 *   (их тут не бывает — плата уходит в казну той же операцией).
 *
 *   Это не обещание в тексте, а устройство: функций для таких действий
 *   здесь просто нет.
 *
 * БЕСПЛАТНОЕ ОСТАЁТСЯ БЕСПЛАТНЫМ НАВСЕГДА
 *
 *   Имя, занятое бесплатно, не имеет срока: expiresAt = 0. Включённая
 *   когда-нибудь плата на него не распространяется и отобрать его за
 *   неуплату нельзя. Платные имена — это аренда с продлением, и только
 *   они когда-либо истекают.
 */

interface INamesV2 {
    function addressOf(string calldata name) external view returns (address);
    function nameOf(address who) external view returns (string memory);
}

contract TavarovNamesV3 {

    uint256 public constant MIN_LEN = 3;
    uint256 public constant MAX_LEN = 20;

    /// Длина адреса в чужой сети. 128 знаков хватает с запасом:
    /// у Solana — 44, у Tron — 34.
    uint256 public constant MAX_REC_LEN = 128;

    /// SLIP-44: этим номером обозначены все EVM-сети разом.
    uint32 public constant EVM = 60;

    /// Границы, за которые не выйдет даже владелец контракта. Нужны не от
    /// нас сегодняшних, а от нас завтрашних — и от того, кто однажды
    /// получит доступ к ключу.
    uint256 public constant MAX_PRICE     = 10 ether;
    uint16  public constant MAX_FREE_LEN  = 8;
    uint64  public constant MIN_TERM      = 30 days;
    uint64  public constant MAX_TERM      = 3650 days;
    uint64  public constant MIN_GRACE     = 7 days;
    uint64  public constant MAX_GRACE     = 365 days;

    INamesV2 public immutable v2;      // старый контракт, читаем как запасной
    address public owner;              // только правила, никогда не чужие имена
    address public treasury;           // куда уходит плата, если она включена

    /// Имена короче этой длины бесплатно не занимаются. Восемь — потолок:
    /// выше владелец поднять не сможет, иначе бесплатных имён не осталось
    /// бы вовсе.
    uint16 public freeMinLen = 6;

    /// Срок аренды платного имени и время после него, когда продлить может
    /// только прежний владелец.
    uint64 public term  = 365 days;
    uint64 public grace = 30 days;

    /// Цена по длине имени, в монете сети. Ноль означает «этой длиной
    /// бесплатно» для длинных и «пока не продаётся» для коротких.
    mapping(uint256 => uint256) public priceByLen;

    /// Запретные слова: занять нельзя никому, включая владельца контракта.
    /// Отдать такое имя можно только через grant — и только тому адресу,
    /// который назовёт владелец, под запись в журнале.
    mapping(bytes32 => bool) public reserved;

    mapping(bytes32 => address) private _holder;    // хеш имени -> чей адрес
    mapping(bytes32 => uint64)  private _expires;   // 0 — навсегда
    mapping(address => string)  private _name;      // адрес -> его имя
    mapping(bytes32 => uint256) private _era;       // номер владения

    // (имя, номер владения, сеть) -> адрес строкой
    mapping(bytes32 => mapping(uint256 => mapping(uint32 => string))) private _rec;

    event Claimed(address indexed who, string name, uint256 paid, uint64 expiresAt);
    event Renewed(address indexed who, string name, uint256 paid, uint64 expiresAt);
    event Released(address indexed who, string name);
    event Moved(address indexed from, address indexed to, string name);
    event RecordSet(string name, uint32 indexed coinType, string value);
    event ReservedSet(string name, bool value);
    /// Слово, которое не удалось закрыть: его уже кто-то занял раньше нас.
    event ReserveSkipped(string name, address holder);
    event Granted(address indexed to, string name);
    event PriceSet(uint256 len, uint256 price);
    event RulesSet(uint16 freeMinLen, uint64 term, uint64 grace);
    event TreasurySet(address treasury);
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "Names: not the owner");
        _;
    }

    constructor(address v2Address, address treasuryAddress) {
        require(treasuryAddress != address(0), "Names: treasury is zero");
        /* Адрес старого контракта либо нулевой (запасного нет вовсе), либо
           по нему обязан лежать код. Опечатка в адресе иначе прошла бы
           молча: обращения к пустому адресу отвечают пустотой, try их
           проглатывает, и все имена второй версии оказались бы свободны —
           узнали бы мы об этом в день, когда их кто-то занял. */
        require(v2Address == address(0) || v2Address.code.length > 0,
                "Names: v2 address has no code");
        v2 = INamesV2(v2Address);          // нулевой адрес допустим: тогда запасного нет
        owner = msg.sender;
        treasury = treasuryAddress;
        emit OwnershipTransferred(address(0), msg.sender);
        emit TreasurySet(treasuryAddress);
    }

    // ------------------------------------------------------------------
    // Проверка имени
    // ------------------------------------------------------------------

    /**
     * Годится ли имя. Правила те же, что и во второй версии, слово в слово.
     *
     * Только a-z, 0-9 и подчёркивание — и это не придирка к красоте, а
     * защита от кражи: русская «а» и латинская «a» на экране неразличимы,
     * и «kоfeinya» с одной русской буквой посередине увело бы деньги
     * чужому.
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

    /// Истёк ли срок аренды вместе с отсрочкой. Бессрочные имена (0) не
    /// истекают никогда.
    function _dead(bytes32 k) internal view returns (bool) {
        uint64 e = _expires[k];
        return e != 0 && block.timestamp > uint256(e) + uint256(grace);
    }

    /**
     * Есть ли у адреса ДЕЙСТВУЮЩЕЕ имя.
     *
     * Истёкшее не в счёт, и запись о нём убирается тут же. Иначе человек,
     * у которого кончилась аренда, не мог бы ни занять новое имя, ни
     * получить чужое: имени у него по факту нет, а запись держит место.
     */
    function _hasLiveName(address who) internal returns (bool) {
        string memory n = _name[who];
        if (bytes(n).length == 0) return false;
        if (_dead(_key(n))) {
            delete _name[who];
            return false;
        }
        return true;
    }

    function _v2AddressOf(string calldata name) internal view returns (address) {
        if (address(v2) == address(0)) return address(0);
        try v2.addressOf(name) returns (address a) { return a; } catch { return address(0); }
    }

    function _v2NameOf(address who) internal view returns (string memory) {
        if (address(v2) == address(0)) return "";
        try v2.nameOf(who) returns (string memory n) { return n; } catch { return ""; }
    }

    // ------------------------------------------------------------------
    // Кто есть кто
    // ------------------------------------------------------------------

    /**
     * Чей это адрес в EVM-сетях. Нулевой адрес означает, что имя свободно.
     *
     * Сначала спрашиваем себя, потом старый контракт: имя, занятое во
     * второй версии, обязано отвечать так же, как отвечало, — иначе люди
     * потеряли бы имена в день нашего переезда.
     */
    function addressOf(string calldata name) external view returns (address) {
        bytes32 k = _key(name);
        address a = _holder[k];
        if (a != address(0)) return _dead(k) ? address(0) : a;
        return _v2AddressOf(name);
    }

    /// Как зовут владельца адреса. Пустая строка — имени нет.
    function nameOf(address who) external view returns (string memory) {
        string memory n = _name[who];
        if (bytes(n).length != 0 && !_dead(_key(n))) return n;
        return _v2NameOf(who);
    }

    /// Когда истекает имя. 0 — никогда (так у всех бесплатных).
    function expiresAt(string calldata name) external view returns (uint64) {
        return _expires[_key(name)];
    }

    /**
     * Свободно ли имя и годится ли оно вообще — одним вопросом.
     * Запретные слова свободными не считаются: занять их нельзя.
     */
    function isFree(string calldata name) external view returns (bool) {
        if (!isValid(name)) return false;
        bytes32 k = _key(name);
        if (reserved[k]) return false;
        if (_holder[k] != address(0) && !_dead(k)) return false;
        return _v2AddressOf(name) == address(0);
    }

    /**
     * Сколько стоит занять это имя прямо сейчас, в монете сети.
     *
     * Ноль означает «бесплатно». Если имя короткое, а цена для его длины не
     * задана, занять его нельзя вовсе — тогда функция отвечает отказом, а не
     * нулём, чтобы приложение не показало человеку «бесплатно» там, где
     * операция не пройдёт.
     */
    function priceOf(string calldata name) public view returns (uint256) {
        require(isValid(name), "Names: bad name");
        uint256 len = bytes(name).length;
        uint256 p = priceByLen[len];
        if (len < freeMinLen) {
            require(p > 0, "Names: short names are not for sale yet");
            return p;
        }
        return p;
    }

    // ------------------------------------------------------------------
    // Занять, продлить, освободить, передать
    // ------------------------------------------------------------------

    /**
     * Занять имя.
     *
     * Бесплатное имя достаётся навсегда: срока у него нет и появиться он не
     * может. Платное — это аренда, и её видно по expiresAt.
     *
     * Сумма проверяется точно, без сдачи: возврат остатка — это лишняя
     * передача монет из контракта, то есть лишнее место для ошибки. Цену
     * приложение спрашивает у контракта прямо перед отправкой.
     */
    function claim(string calldata name) external payable {
        require(isValid(name), "Names: only a-z 0-9 _ , 3-20, not starting with a digit");
        bytes32 k = _key(name);
        require(!reserved[k], "Names: this name is reserved");
        require(_holder[k] == address(0) || _dead(k), "Names: already taken");
        require(_v2AddressOf(name) == address(0), "Names: already taken");
        require(!_hasLiveName(msg.sender), "Names: you already have a name");
        require(bytes(_v2NameOf(msg.sender)).length == 0, "Names: you already have a name");

        uint256 len = bytes(name).length;
        uint256 p = priceByLen[len];
        if (len < freeMinLen) require(p > 0, "Names: short names are not for sale yet");

        uint64 until = 0;
        if (p > 0) {
            require(msg.value == p, "Names: wrong amount");
            until = uint64(block.timestamp) + term;
        } else {
            require(msg.value == 0, "Names: this name is free");
        }

        /* Имя могло принадлежать кому-то и истечь. Тогда номер владения
           растёт, и записи прежнего хозяина перестают действовать в ту же
           секунду: новый владелец получает чистое имя, а не чужие адреса. */
        address before = _holder[k];
        if (before != address(0)) {
            delete _name[before];
            _era[k] += 1;
        }

        _holder[k] = msg.sender;
        _expires[k] = until;
        _name[msg.sender] = name;
        emit Claimed(msg.sender, name, p, until);

        /* Деньги отправляем ПОСЛЕДНИМ действием, когда всё уже записано.
           Отправка — это вызов чужого кода, и он может вернуться сюда в
           середине нашей работы. Если бы запись шла после отправки, такой
           возврат позволил бы занять одно имя дважды. */
        if (p > 0) _send(p);
    }

    /**
     * Продлить арендованное имя. Может только его владелец и только пока
     * не кончилась отсрочка. Бессрочное имя продлевать не нужно и нельзя:
     * попытка отвечает отказом, а не тратит деньги впустую.
     */
    function renew(string calldata name) external payable {
        bytes32 k = _key(name);
        require(_holder[k] == msg.sender, "Names: not your name");
        require(_expires[k] != 0, "Names: this name has no term");
        require(!_dead(k), "Names: the grace period is over");

        /* Цену за эту длину могли уже после сдачи имени опустить до нуля.
           Тогда продление бесплатно: требовать денег не за что, а отказывать
           в продлении значило бы убить чужое имя нашим же решением — оно
           дождалось бы конца отсрочки и ушло первому желающему. */
        uint256 p = priceByLen[bytes(name).length];
        require(msg.value == p, "Names: wrong amount");

        /* Считаем от большего из двух: от прежнего срока, если он ещё не
           вышел, и от сегодня, если уже вышел. Иначе продление в отсрочке
           давало бы срок, начавшийся в прошлом. */
        uint64 base = _expires[k] > uint64(block.timestamp) ? _expires[k] : uint64(block.timestamp);
        uint64 until = base + term;
        _expires[k] = until;
        emit Renewed(msg.sender, name, p, until);
        if (p > 0) _send(p);            // тоже последним действием
    }

    /// Освободить своё имя. Записи прежнего владельца перестают действовать.
    function release() external {
        string memory n = _name[msg.sender];
        require(bytes(n).length != 0, "Names: you have no name");
        bytes32 k = _key(n);
        delete _holder[k];
        delete _expires[k];
        delete _name[msg.sender];
        _era[k] += 1;
        emit Released(msg.sender, n);
    }

    /**
     * Отдать своё имя другому адресу. Срок переезжает вместе с именем:
     * арендованное остаётся арендованным, бессрочное — бессрочным.
     */
    function transferTo(address newHolder) external {
        require(newHolder != address(0), "Names: new holder is zero");
        require(newHolder != msg.sender, "Names: same address");
        string memory n = _name[msg.sender];
        require(bytes(n).length != 0, "Names: you have no name");
        require(!_hasLiveName(newHolder), "Names: that address already has a name");
        require(bytes(_v2NameOf(newHolder)).length == 0, "Names: that address already has a name");

        bytes32 k = _key(n);
        require(!_dead(k), "Names: the name has expired");

        delete _name[msg.sender];
        _holder[k] = newHolder;
        _name[newHolder] = n;
        /* Номер владения растёт и здесь: новый владелец получает имя без
           чужих записей о других сетях. Деньги, отправленные по старой
           записи, ушли бы прежнему хозяину. */
        _era[k] += 1;
        emit Moved(msg.sender, newHolder, n);
    }

    // ------------------------------------------------------------------
    // Адреса в других сетях
    // ------------------------------------------------------------------

    /**
     * Адрес имени в указанной сети, строкой.
     *
     * Для EVM (60) заводить ничего не нужно: если записи нет, возвращается
     * адрес владельца. Пустая строка означает «в этой сети адреса нет, не
     * отправляйте».
     */
    function recordOf(string calldata name, uint32 coinType) public view returns (string memory) {
        bytes32 k = _key(name);
        if (_holder[k] != address(0) && !_dead(k)) {
            string memory v = _rec[k][_era[k]][coinType];
            if (bytes(v).length != 0) return v;
            if (coinType == EVM) return _toHex(_holder[k]);
            return "";
        }
        /* Своего владельца нет — отвечаем за старый контракт, но только про
           EVM: записей о других сетях там нет. */
        if (coinType == EVM) {
            address a = _v2AddressOf(name);
            if (a != address(0)) return _toHex(a);
        }
        return "";
    }

    /// Записать свой адрес в другой сети. Только для своего имени.
    function setRecord(uint32 coinType, string calldata value) external {
        string memory n = _name[msg.sender];
        require(bytes(n).length != 0, "Names: you have no name");
        require(bytes(value).length <= MAX_REC_LEN, "Names: value too long");
        bytes32 k = _key(n);
        require(!_dead(k), "Names: the name has expired");
        _rec[k][_era[k]][coinType] = value;
        emit RecordSet(n, coinType, value);
    }

    // ------------------------------------------------------------------
    // Правила. Всё, что может владелец контракта, — здесь и только здесь
    // ------------------------------------------------------------------

    /**
     * Объявить слова запретными или вернуть их в оборот.
     *
     * Запретить можно только СВОБОДНОЕ слово. Занятое имя не трогается
     * ничем и никогда — иначе запрет стал бы способом отобрать.
     */
    function setReserved(string[] calldata names, bool value) external onlyOwner {
        for (uint256 i = 0; i < names.length; i++) {
            bytes32 k = _key(names[i]);
            if (value) {
                /* Слово, которое уже кто-то успел занять, закрыть нельзя:
                   запрет не должен становиться способом отобрать. Но и всю
                   операцию из-за него валить незачем — иначе одно занятое
                   слово оставило бы незакрытыми остальные сорок. Пропускаем
                   его и пишем об этом в журнал, чтобы пропуск не оказался
                   незамеченным. */
                address held = _holder[k];
                if (held != address(0) && !_dead(k)) { emit ReserveSkipped(names[i], held); continue; }
                address old2 = _v2AddressOf(names[i]);
                if (old2 != address(0)) { emit ReserveSkipped(names[i], old2); continue; }
            }
            reserved[k] = value;
            emit ReservedSet(names[i], value);
        }
    }

    /// Можно ли закрыть это слово прямо сейчас. Пусто — значит уже занято.
    function canReserve(string calldata name) external view returns (bool) {
        bytes32 k = _key(name);
        if (_holder[k] != address(0) && !_dead(k)) return false;
        return _v2AddressOf(name) == address(0);
    }

    /**
     * Отдать запретное слово названному адресу — например, наш support
     * нашему же официальному кошельку. Отдаётся бессрочно и бесплатно, и
     * только то, что до сих пор никому не принадлежало.
     */
    function grant(string calldata name, address to) external onlyOwner {
        require(to != address(0), "Names: holder is zero");
        require(isValid(name), "Names: bad name");
        bytes32 k = _key(name);
        require(reserved[k], "Names: not reserved");
        require(_holder[k] == address(0) || _dead(k), "Names: already taken");
        require(_v2AddressOf(name) == address(0), "Names: already taken");
        require(!_hasLiveName(to), "Names: that address already has a name");
        require(bytes(_v2NameOf(to)).length == 0, "Names: that address already has a name");

        address before = _holder[k];
        if (before != address(0)) { delete _name[before]; _era[k] += 1; }

        reserved[k] = false;
        _holder[k] = to;
        _expires[k] = 0;
        _name[to] = name;
        emit ReservedSet(name, false);
        emit Granted(to, name);
    }

    /// Цена по длине имени. Ноль — бесплатно (для длинных) или «не
    /// продаётся» (для коротких).
    function setPrice(uint256 len, uint256 price) external onlyOwner {
        require(len >= MIN_LEN && len <= MAX_LEN, "Names: bad length");
        require(price <= MAX_PRICE, "Names: price too high");
        priceByLen[len] = price;
        emit PriceSet(len, price);
    }

    function setRules(uint16 newFreeMinLen, uint64 newTerm, uint64 newGrace) external onlyOwner {
        require(newFreeMinLen >= MIN_LEN && newFreeMinLen <= MAX_FREE_LEN, "Names: bad free length");
        require(newTerm >= MIN_TERM && newTerm <= MAX_TERM, "Names: bad term");
        require(newGrace >= MIN_GRACE && newGrace <= MAX_GRACE, "Names: bad grace");
        freeMinLen = newFreeMinLen;
        term = newTerm;
        grace = newGrace;
        emit RulesSet(newFreeMinLen, newTerm, newGrace);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Names: treasury is zero");
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Names: new owner is zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * Отказаться от власти навсегда. После этого правила застывают: ни
     * цены, ни запреты, ни сроки не меняются больше никем. Сделать это
     * стоит в тот день, когда правила устоятся.
     */
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    // ------------------------------------------------------------------
    // Деньги
    // ------------------------------------------------------------------

    /**
     * Плата уходит в казну той же операцией. В контракте не остаётся ни
     * монеты — а значит, отсюда нечего выводить, и функции вывода здесь
     * нет вовсе.
     */
    function _send(uint256 amount) internal {
        (bool ok, ) = treasury.call{ value: amount }("");
        require(ok, "Names: treasury refused the payment");
    }

    /// Случайно присланные монеты принимать незачем: их потом никак не
    /// достать. Отказываемся сразу.
    receive() external payable {
        revert("Names: send nothing here");
    }

    // ------------------------------------------------------------------

    /* Слово в слово из второй версии: этот кусок уже работает в основной
       сети, и переписывать его заново значило бы искать себе новую ошибку
       на ровном месте. */
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
