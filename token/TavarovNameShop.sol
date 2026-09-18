// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TavarovNameShop — магазин коротких имён за баллы TVR.
 *
 * ЗАЧЕМ ОН ВООБЩЕ НУЖЕН
 *
 * Баллы, которые некуда деть, — это не баллы, а цифра на экране. До сегодня
 * TVR был именно такой цифрой: начислялся за покупки и лежал мёртвым грузом.
 * Этот контракт даёт ему ровно одно применение — короткое имя.
 *
 * Имён вида «cafe» или «max» мало по природе вещей: трёхбуквенных сочетаний
 * из тридцати семи знаков конечное число, и раздаём их только мы. Поэтому
 * они годятся в обмен на баллы, а, скажем, «скидка на следующую покупку» —
 * нет: скидку можно печатать бесконечно, и она ничего не стоит.
 *
 * ЧЕГО ЭТОТ КОНТРАКТ НЕ ДЕЛАЕТ И НЕ БУДЕТ
 *
 * Он не обещает, что балл подорожает. Он не торгует баллами, не меняет их
 * на деньги и не знает никакого «курса». Цену имени в баллах назначает
 * владелец руками, и она не зависит ни от какого рынка. Это талон на вещь,
 * а не доля в чём-либо.
 *
 * КАК УСТРОЕНО
 *
 * Имя выдаётся функцией grant в контракте имён, а она доступна только его
 * владельцу. Значит, чтобы магазин выдавал имена сам, без человека в
 * середине, владельцем контракта имён должен стать этот магазин.
 *
 * Это самое опасное место во всей затее, и прятать это нельзя: пока
 * магазин владеет именами, ошибка в НЁМ становится ошибкой в ИМЕНАХ.
 * Поэтому здесь нет ничего лишнего — ни приёма денег на баланс, ни
 * сложных расчётов, ни возможности выполнить произвольный вызов. И
 * поэтому же есть returnNamesOwnership: власть над именами возвращается
 * человеку одной операцией, в любой момент, без чьего-либо согласия.
 *
 * Купленное имя достаётся навсегда, а не в аренду: grant выдаёт бессрочно.
 * Так честнее для того, кто отдал за него баллы, накопленные покупками.
 */

interface INamesV3 {
    function isValid(string memory name) external pure returns (bool);
    function canReserve(string calldata name) external view returns (bool);
    function reserved(bytes32 key) external view returns (bool);
    function setReserved(string[] calldata names, bool value) external;
    function grant(string calldata name, address to) external;
    function setPrice(uint256 len, uint256 price) external;
    function setRules(uint16 freeMinLen, uint64 term, uint64 grace) external;
    function transferOwnership(address newOwner) external;
    function owner() external view returns (address);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

contract TavarovNameShop {

    /* Сжигать — значит отправить туда, откуда никто не достанет. У наших
       баллов нет отдельной функции сжигания, а перевод на нулевой адрес
       токен запрещает, поэтому используем общепринятый «мёртвый» адрес:
       приватного ключа к нему не существует. */
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    /* Границы длины, которой торгует магазин. Длинные имена и так достаются
       бесплатно — продавать их значило бы брать деньги за воздух. */
    uint256 public constant MIN_LEN = 3;
    uint256 public constant MAX_LEN = 5;

    /* Потолок цены. Нужен не от злого умысла, а от опечатки: лишний ноль в
       цене превращает магазин в неработающий, и заметить это можно не
       сразу. Сто миллионов — это весь выпуск баллов целиком. */
    uint256 public constant MAX_PRICE = 100_000_000 ether;

    IERC20   public immutable tvr;
    INamesV3 public immutable names;
    address  public owner;

    /* Цена имени в баллах, по длине. Ноль означает «эта длина не продаётся»,
       а не «бесплатно»: бесплатных коротких имён здесь нет и быть не может,
       иначе их разберут роботы за одну ночь. */
    mapping(uint256 => uint256) public priceByLen;

    /* Замок от повторного входа. Баллы — наш собственный токен, и ловушек
       внутри него нет, но замок стоит один раз и навсегда закрывает целый
       класс ошибок. */
    uint256 private _lock = 1;

    event Bought(address indexed buyer, string name, uint256 burned);
    event PriceSet(uint256 len, uint256 price);
    event OwnershipTransferred(address indexed from, address indexed to);
    event NamesOwnershipReturned(address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "Shop: not the owner");
        _;
    }

    modifier noReentry() {
        require(_lock == 1, "Shop: reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address tvrAddress, address namesAddress) {
        /* По обоим адресам обязан лежать код. Без этой проверки опечатка в
           адресе прошла бы молча: обращения к пустому адресу отвечают
           пустотой, и магазин развернулся бы «рабочим», а сломался бы в
           день первой покупки. Ровно на этом мы уже обжигались 13 сентября
           при выпуске третьей версии имён. */
        require(tvrAddress.code.length > 0,   "Shop: TVR address has no code");
        require(namesAddress.code.length > 0, "Shop: names address has no code");
        tvr = IERC20(tvrAddress);
        names = INamesV3(namesAddress);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------------
    // Покупка
    // ------------------------------------------------------------------

    /// Цена имени в баллах. Ноль — эта длина не продаётся.
    function priceOf(string calldata name) public view returns (uint256) {
        if (!names.isValid(name)) return 0;
        uint256 len = bytes(name).length;
        if (len < MIN_LEN || len > MAX_LEN) return 0;
        return priceByLen[len];
    }

    /**
     * Можно ли купить это имя прямо сейчас. Приложению нужен ответ до
     * отправки операции: показать человеку «занято» дешевле, чем дать ему
     * потратить газ на отказ.
     */
    function canBuy(string calldata name) external view returns (bool) {
        if (priceOf(name) == 0) return false;
        if (names.owner() != address(this)) return false;   // магазин ещё не хозяин имён
        return names.canReserve(name);
    }

    /**
     * Купить имя за баллы.
     *
     * Порядок важен: сначала забираем баллы, потом выдаём имя. Наоборот
     * было бы подарком любому, у кого не хватает баллов, — выдача прошла бы,
     * а оплата отвалилась.
     *
     * Балл не «переводится нам», а сжигается. Продать его второй раз нельзя
     * никому, включая нас: то, что отдано за имя, исчезает из обращения
     * навсегда.
     */
    function buy(string calldata name) external noReentry {
        uint256 price = priceOf(name);
        require(price > 0, "Shop: this name is not for sale");
        require(names.owner() == address(this), "Shop: the shop does not own the names contract");

        /* Занятое имя не продаём. Контракт имён и сам не даст его отдать, но
           отказ с понятной причиной лучше отказа из чужих недр. */
        require(names.canReserve(name), "Shop: this name is already taken");

        require(tvr.transferFrom(msg.sender, BURN, price), "Shop: paying with TVR failed");

        /* Выдать имя можно только запретное — так устроен grant. Магазин
           владеет именами, значит закрывает слово и тут же отдаёт его
           покупателю, в одной операции. Между этими двумя шагами никто
           вклиниться не может: внутри одной операции чужого кода нет. */
        string[] memory one = new string[](1);
        one[0] = name;
        names.setReserved(one, true);
        names.grant(name, msg.sender);

        emit Bought(msg.sender, name, price);
    }

    // ------------------------------------------------------------------
    // Настройки магазина
    // ------------------------------------------------------------------

    /// Назначить цену для длины. Ноль — снять с продажи.
    function setPrice(uint256 len, uint256 price) external onlyOwner {
        require(len >= MIN_LEN && len <= MAX_LEN, "Shop: length out of range");
        require(price <= MAX_PRICE, "Shop: price too high");
        priceByLen[len] = price;
        emit PriceSet(len, price);
    }

    /// Назначить цены сразу нескольким длинам — чтобы не платить за газ трижды.
    function setPrices(uint256[] calldata lens, uint256[] calldata prices) external onlyOwner {
        require(lens.length == prices.length, "Shop: lists do not match");
        for (uint256 i = 0; i < lens.length; i++) {
            require(lens[i] >= MIN_LEN && lens[i] <= MAX_LEN, "Shop: length out of range");
            require(prices[i] <= MAX_PRICE, "Shop: price too high");
            priceByLen[lens[i]] = prices[i];
            emit PriceSet(lens[i], prices[i]);
        }
    }

    // ------------------------------------------------------------------
    // Управление контрактом имён, пока магазин им владеет
    // ------------------------------------------------------------------
    //
    // Здесь НЕ «выполнить произвольный вызов». Произвольный вызов — это
    // дверь, за которой может оказаться что угодно, включая то, о чём
    // подписывающий не подумал. Вместо неё перечислены поимённо те три
    // вещи, ради которых власть над именами вообще нужна.

    /// Закрыть или открыть запретные слова — список из 187 слов и всё, что добавится.
    function namesSetReserved(string[] calldata list, bool value) external onlyOwner {
        names.setReserved(list, value);
    }

    /// Подарить имя без оплаты: наши официальные имена, поддержка, партнёры.
    function namesGrant(string calldata name, address to) external onlyOwner {
        require(to != address(0), "Shop: holder is zero");
        names.grant(name, to);
    }

    /// Цена обычного (не короткого) имени в монете сети — правило самого контракта имён.
    function namesSetPrice(uint256 len, uint256 price) external onlyOwner {
        names.setPrice(len, price);
    }

    /// Сроки и порог бесплатности в контракте имён.
    function namesSetRules(uint16 freeMinLen, uint64 term, uint64 grace) external onlyOwner {
        names.setRules(freeMinLen, term, grace);
    }

    /**
     * Запасной выход.
     *
     * Возвращает власть над именами обычному кошельку. Нужен на случай,
     * когда в магазине найдётся ошибка, или когда магазин просто перестанет
     * быть нужным. После этого магазин продавать имена больше не сможет —
     * buy будет честно отказывать, потому что проверяет владельца.
     *
     * Это единственная дверь, через которую власть уходит из магазина, и
     * открыть её может только владелец магазина.
     */
    function returnNamesOwnership(address to) external onlyOwner {
        require(to != address(0), "Shop: new owner is zero");
        names.transferOwnership(to);
        emit NamesOwnershipReturned(to);
    }

    // ------------------------------------------------------------------
    // Владелец магазина
    // ------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Shop: new owner is zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * Вынуть монеты, присланные сюда по ошибке.
     *
     * Магазин не хранит денег: баллы за имя уходят прямо в огонь, мимо его
     * баланса. Но люди присылают токены не туда каждый день, и без этой
     * функции они остались бы здесь навсегда.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Shop: recipient is zero");
        require(IERC20(token).transfer(to, amount), "Shop: rescue failed");
    }

    /* Монеты сети сюда не принимаются вовсе: принимать то, чем не торгуешь,
       значит однажды объяснять человеку, куда делись его деньги. */
    receive() external payable {
        revert("Shop: this shop takes only TVR");
    }
}
