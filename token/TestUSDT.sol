// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ТОЛЬКО ДЛЯ ПРОВЕРКИ. В основную сеть этот файл не разворачивать никогда.
 *
 * Поддельный USDT: шесть знаков после запятой, как у настоящего, и функция
 * mint, которой любой может напечатать себе сколько угодно. Нужен, чтобы
 * прогнать всю схему оплаты, не имея настоящих денег.
 */
contract TestUSDT {
    string public constant name = "Test USDT";
    string public constant symbol = "tUSDT";
    uint8  public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// Напечатать себе денег для проверки. Указывайте в целых долларах.
    function mint(uint256 wholeDollars) external {
        uint256 amount = wholeDollars * 1e6;
        balanceOf[msg.sender] += amount;
        totalSupply += amount;
        emit Transfer(address(0), msg.sender, amount);
    }

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
        if (allowed != type(uint256).max) {
            require(allowed >= value, "tUSDT: allowance too low");
            unchecked { allowance[from][msg.sender] = allowed - value; }
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "tUSDT: transfer to zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "tUSDT: balance too low");
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
