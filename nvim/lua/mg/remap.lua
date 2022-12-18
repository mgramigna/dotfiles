-- Easy window switching
vim.keymap.set("n", "<C-k>", ":wincmd k<cr>")
vim.keymap.set("n", "<C-j>", ":wincmd j<cr>")
vim.keymap.set("n", "<C-h>", ":wincmd h<cr>")
vim.keymap.set("n", "<C-l>", ":wincmd l<cr>")

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

-- Update Plugins
vim.keymap.set("n", "<leader>ps", function()
	local plugin_file_path = vim.fn.stdpath("config") .. "/lua/mg/plugins.lua"
	vim.cmd("source " .. plugin_file_path)

	vim.cmd("PackerSync")
end)
