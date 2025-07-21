-- Map `jk` to escape
vim.keymap.set("i", "jk", "<esc>")

-- Replace text in visual selection without overwriting paste register (clutch)
vim.keymap.set("v", "<leader>p", '"_dP')

-- Move lines up/down in visual mode
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv")
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv")

-- Copy to system clipboard
vim.keymap.set({ "n", "v" }, "<leader>y", [["+y]])
vim.keymap.set("n", "<leader>Y", [["+Y]])
vim.keymap.set({ "n", "v" }, "<leader>d", [["_d]])

-- Search and replace under cursor
vim.keymap.set("n", "<leader>sr", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]])

-- Print full file path
vim.keymap.set("n", "<leader>fp", "<cmd>lua print(vim.fn.expand('%'))<cr>")

-- Tab navigation
vim.keymap.set("n", "<leader>tn", "<cmd>tabnext<cr>")
vim.keymap.set("n", "<leader>tp", "<cmd>tabprevious<cr>")

-- Term
vim.keymap.set("n", "<leader>st", function()
	vim.cmd.vnew()
	vim.cmd.term()
	vim.cmd.wincmd("J")
	vim.api.nvim_win_set_height(0, 15)
	vim.cmd.startinsert()
end)

-- Lua execution
vim.keymap.set("n", "<space><space>x", "<cmd>source %<CR>", { silent = true })
vim.keymap.set("n", "<space>x", ":.lua<CR>", { silent = true })
vim.keymap.set("v", "<space>x", ":lua<CR>", { silent = true })

-- Typos
vim.api.nvim_create_user_command("Qa", "qa", {})

-- Better wrapped line navigation
vim.keymap.set("n", "j", "gj")
vim.keymap.set("n", "k", "gk")

-- Save and quit shorthand
vim.keymap.set("n", "<leader>w", "<cmd>w<cr>")
vim.keymap.set("n", "<leader>q", "<cmd>q<cr>")
vim.keymap.set("n", "<leader>v", "<cmd>vsp<cr>")
vim.keymap.set("n", "<leader>x", "<cmd>sp<cr>")
