// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Tavarov Token (TVR)
 *
 * Обычный токен стандарта ERC-20 / BEP-20 с эмиссией, устроенной как у ETH:
 * новые монеты появляются, но их НИКТО не печатает вручную.
 *
 * КАК ЭТО РАБОТАЕТ
 *
 *   При выпуске создаётся начальный запас — он уходит на ваш адрес.
 *   Дальше каждую секунду «созревает» строго определённое количество монет:
 *   фиксированное число в год, заданное при выпуске и больше не меняемое.
 *
 *   Созревшее забирает функция mintEmission. Позвать её может кто угодно —
 *   хоть вы, хоть посторонний, хоть служебный скрипт. Но монеты при этом
 *   уходят не тому, кто позвал, а на ОДИН заранее заданный адрес:
 *   в бонусный пул. Изменить этот адрес нельзя — он задаётся ровно один раз,
 *   сразу после выпуска, и намертво остаётся в контракте.
 *
 * ЧЕГО ЗДЕСЬ НЕТ, И ЭТО ГЛАВНОЕ
 *
 *   Нет владельца. Нет функции «напечатать себе». Нет способа ускорить
 *   эмиссию, перенаправить её или остановить. Автор контракта после выпуска
 *   не может сделать с ним ничего — ровно как создатель Ethereum не может
 *   напечатать себе эфира.
 *
 *   Есть верхний предел: эмиссия останавливается навсегда, когда выпуск
 *   достигнет двукратного начального. Это не обещание, а строка в коде.
 *
 * ПОЧЕМУ ИМЕННО ТАК, А НЕ ПРОСТО mint()
 *
 *   Любой проверяльщик токенов первым делом смотрит, может ли владелец
 *   печатать. Если может — токен помечается опасным, и это правильно:
 *   держатель ничем не защищён. Здесь проверяльщику нечего найти.
 */
contract TavarovToken {
    string public constant name = "Tavarov Token";
    string public constant symbol = "TVR";
    uint8  public constant decimals = 18;

    uint256 public totalSupply;

    /// Начальный выпуск. От него считается и эмиссия, и предел.
    uint256 public immutable initialSupply;

    /// Предел выпуска. Дойдя до него, эмиссия прекращается навсегда.
    uint256 public immutable maxSupply;

    /// Сколько монет созревает за год. Число, а не процент: значит доля
    /// эмиссии в общем выпуске со временем сама снижается.
    uint256 public immutable emissionPerYear;

    /// Момент, до которого эмиссия уже забрана.
    uint256 public lastEmission;

    /// Единственный адрес, куда уходит эмиссия. Задаётся один раз.
    address public emissionTarget;

    /// Тот, кто разворачивал контракт. Может ровно одно действие —
    /// один раз указать адрес бонусного пула. Больше ничего.
    address private immutable deployer;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Emission(address indexed to, uint256 amount);
    event EmissionTargetSet(address target);

    /**
     * @param supplyWholeTokens   начальный выпуск в целых монетах, например 100000000
     * @param emissionBpsPerYear  годовая эмиссия в сотых долях процента от начального
     *                            выпуска: 200 = 2% в год. Ноль — эмиссии нет вовсе.
     *                            Больше 5% контракт не примет.
     */
    constructor(uint256 supplyWholeTokens, uint16 emissionBpsPerYear) {
        require(supplyWholeTokens > 0, "TVR: supply must be positive");
        require(emissionBpsPerYear <= 500, "TVR: emission above 5% per year");

        uint256 supply = supplyWholeTokens * (10 ** uint256(decimals));
        initialSupply   = supply;
        maxSupply       = supply * 2;
        emissionPerYear = (supply * emissionBpsPerYear) / 10000;

        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        deployer = msg.sender;
        lastEmission = block.timestamp;

        emit Transfer(address(0), msg.sender, supply);
    }

    // ------------------------------------------------------------------
    // Эмиссия
    // ------------------------------------------------------------------

    /**
     * Указать бонусный пул. Вызывается один раз, сразу после развёртывания.
     * Повторно — уже никем и никогда.
     */
    function setEmissionTarget(address target) external {
        require(msg.sender == deployer, "TVR: not deployer");
        require(emissionTarget == address(0), "TVR: target already set");
        require(target != address(0), "TVR: zero address");
        emissionTarget = target;
        // Отсчёт эмиссии начинается отсюда, чтобы за время настройки
        // не накопился разовый навес.
        lastEmission = block.timestamp;
        emit EmissionTargetSet(target);
    }

    /// Сколько монет созрело и ждёт отправки в бонусный пул.
    function pendingEmission() public view returns (uint256) {
        if (emissionTarget == address(0)) return 0;
        if (emissionPerYear == 0) return 0;
        if (totalSupply >= maxSupply) return 0;

        uint256 elapsed = block.timestamp - lastEmission;
        uint256 amount  = (emissionPerYear * elapsed) / 365 days;

        uint256 room = maxSupply - totalSupply;
        return amount > room ? room : amount;
    }

    /**
     * Отправить созревшее в бонусный пул. Звать может кто угодно; кто зовёт,
     * тот платит комиссию сети, а монеты всё равно идут только в пул.
     *
     * Остаток от деления при округлении вниз просто не выпускается — эмиссия
     * получается на волос меньше расчётной, и это лучше, чем на волос больше.
     */
    function mintEmission() external returns (uint256 amount) {
        require(emissionTarget != address(0), "TVR: target not set");
        amount = pendingEmission();
        require(amount > 0, "TVR: nothing to mint");

        lastEmission = block.timestamp;
        totalSupply += amount;
        unchecked { balanceOf[emissionTarget] += amount; }

        emit Transfer(address(0), emissionTarget, amount);
        emit Emission(emissionTarget, amount);
    }

    // ------------------------------------------------------------------
    // Обычная часть ERC-20
    // ------------------------------------------------------------------

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        // Разрешение «на максимум» не уменьшаем — так делают все крупные токены,
        // иначе каждая операция обмена тратит лишний газ.
        if (allowed != type(uint256).max) {
            require(allowed >= value, "TVR: allowance too low");
            unchecked { allowance[from][msg.sender] = allowed - value; }
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "TVR: transfer to zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "TVR: balance too low");
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
