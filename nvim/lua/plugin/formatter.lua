return function()
  local prettier = function()
    return {
      exe = "prettier",
      args = {"--stdin-filepath", vim.api.nvim_buf_get_name(0), '--single-quote'},
      stdin = true
    }
  end

  require('formatter').setup({
    logging = false,
    filetype = {
      javascript = { prettier },
      typescript = { prettier },
      javascriptreact = { prettier },
      typescriptreact = { prettier },
      json = { prettier },
      markdown = { prettier }
    }
  })

  vim.api.nvim_exec([[
    augroup FormatAutogroup
      autocmd!
      autocmd BufWritePost *.js,*.ts,*.jsx,*.tsx FormatWrite
    augroup END
    ]], true)
end