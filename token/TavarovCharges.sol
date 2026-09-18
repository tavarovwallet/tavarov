// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TavarovCharges — «сколько сейчас просит этот продавец».
 *
 * ЗАЧЕМ
 *
 *   У продавца на кассе висит распечатанная наклейка с QR. Она не меняется,
 *   и суммы в ней нет — иначе её пришлось бы перепечатывать после каждой
 *   покупки.
 *
 *   Кассир набирает у себя «Кофе латте, 3.50» и нажимает кнопку. Сумма
 *   ложится сюда. Покупатель сканирует наклейку, приложение спрашивает
 *   у этого контракта, чего продавец хочет прямо сейчас, и показывает
 *   готовую оплату. Покупателю остаётся нажать «Отправить».
 *
 * ЧТО ЗДЕСЬ ЛЕЖИТ И ЧЕГО НЕТ
 *
 *   Здесь нет денег. Совсем. Это доска объявлений: продавец пишет, чего
 *   просит, покупатель читает. Красть тут нечего, и владельца у контракта
 *   тоже нет — ни у кого нет власти над чужими объявлениями.
 *
 *   Написать счёт может только сам продавец, от своего адреса. Подделать
 *   чужой счёт невозможно: ключ — это msg.sender, его не подменишь.
 *
 * ПОЧЕМУ У СЧЁТА ЕСТЬ СРОК
 *
 *   Забытый счёт опаснее, чем кажется: человек через час сканирует ту же
 *   наклейку и платит за чужой кофе. Поэтому счёт живёт ограниченное время
 *   и после этого считается недействительным сам, без чьего-либо участия.
 *
 * ЧТО ВИДНО ВСЕМ
 *
 *   Блокчейн публичен: сумма и описание видны кому угодно и остаются
 *   навсегда. Для «Кофе латте» это неважно. Писать сюда имена, номера
 *   договоров и прочее личное нельзя — и приложение об этом предупреждает.
 */
contract TavarovCharges {

    /// Дольше часа счёт жить не может. Ограничение в коде, обойти нельзя.
    uint32 public constant MAX_TTL = 3600;
    /// Описание короткое: и газ дешевле, и соблазна написать лишнее меньше.
    uint256 public constant MAX_ITEM_LEN = 64;

    struct Charge {
        address token;      // чем платить: адрес токена
        uint128 amount;     // сколько, в минимальных долях этого токена
        uint64  expiresAt;  // после этого момента счёт недействителен
        string  item;       // за что
    }

    mapping(address => Charge) private charges;

    event ChargeSet(address indexed merchant, address token, uint256 amount, uint64 expiresAt, string item);
    event ChargeCleared(address indexed merchant);

    /**
     * Выставить счёт от своего имени.
     * Новый счёт полностью заменяет прежний — двух одновременно не бывает.
     */
    function setCharge(address token, uint128 amount, string calldata item, uint32 ttl) external {
        require(token != address(0), "Charge: token is zero");
        require(amount > 0, "Charge: amount is zero");
        require(ttl > 0 && ttl <= MAX_TTL, "Charge: bad ttl");
        require(bytes(item).length <= MAX_ITEM_LEN, "Charge: item too long");

        uint64 expires = uint64(block.timestamp) + uint64(ttl);
        charges[msg.sender] = Charge({ token: token, amount: amount, expiresAt: expires, item: item });
        emit ChargeSet(msg.sender, token, amount, expires, item);
    }

    /// Снять свой счёт. Обычно это делает касса, увидев оплату.
    function clearCharge() external {
        delete charges[msg.sender];
        emit ChargeCleared(msg.sender);
    }

    /**
     * Что продавец просит прямо сейчас.
     * active — главное поле: false означает, что счёта нет или он просрочен,
     * и платить по нему нельзя.
     */
    function currentCharge(address merchant)
        external view
        returns (address token, uint256 amount, string memory item, uint64 expiresAt, bool active)
    {
        Charge memory c = charges[merchant];
        return (
            c.token,
            uint256(c.amount),
            c.item,
            c.expiresAt,
            c.amount > 0 && block.timestamp < c.expiresAt
        );
    }
}
